/**
 * WhatsApp broadcasts — a marketing send to a lead segment, run from the CRM.
 *
 * Two decisions shape this file.
 *
 * FREEZE THE AUDIENCE. Recipients are materialised into rows when the broadcast
 * is queued, not recomputed while sending. A segment is a live query, so
 * recomputing would let the audience shift under a partly-delivered campaign —
 * a lead who changed stage between chunk 1 and chunk 7 would silently be added
 * or dropped, and the report could never be reconciled. A frozen list makes a
 * broadcast an auditable fact.
 *
 * ASSUME THE DRAIN IS INTERRUPTED. This runs on Vercel, where a request is
 * killed at 60 seconds and Hobby-plan crons fire once a day. A send of a few
 * thousand cannot finish in one pass, so the drain is chunked, bounded by BOTH
 * count and elapsed time, and resumable: it claims work by flipping row state,
 * and whatever is still `pending` is simply picked up next run. Nothing is held
 * in memory between chunks, because nothing survives there.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { buildLeadWhere, type LeadFilterParams } from "../crm-leads";
import { buildLeadMergeVars, fillTemplate } from "../crm";
import { logger } from "../logger";
import {
  getSetting,
  WA_BROADCAST_BATCH_KEY,
  WA_BROADCAST_ENABLED_KEY,
} from "../app-settings";
import { getWaProvider } from "./registry";

/** Recipients per drain run, unless an admin overrides it. */
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

/**
 * Wall-clock budget for one drain pass. Vercel kills the request at 60s, and a
 * kill mid-send is the one thing that can lose a message: the provider may have
 * accepted it while our row still says `pending`, and the next run would send
 * again. Stopping early with time to spare keeps that window closed.
 */
const DRAIN_TIME_BUDGET_MS = 45_000;

/** Meta rate-limits template sends; a small gap keeps a burst from tripping it. */
const INTER_SEND_DELAY_MS = 120;

export type BroadcastConfig = { enabled: boolean; batchSize: number };

export async function getBroadcastConfig(): Promise<BroadcastConfig> {
  const [enabled, batch] = await Promise.all([
    getSetting(WA_BROADCAST_ENABLED_KEY).catch(() => null),
    getSetting(WA_BROADCAST_BATCH_KEY).catch(() => null),
  ]);
  const parsed = Number.parseInt(batch || "", 10);
  return {
    enabled: enabled === "1",
    batchSize: Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_BATCH_SIZE) : DEFAULT_BATCH_SIZE,
  };
}

/** Why a lead in the segment will not be messaged. Decided once, never retried. */
export type SkipReason = "no_phone" | "opted_out" | "undeliverable";

/**
 * Leads that must never receive a marketing broadcast, whatever the segment says.
 *
 * Opt-out is a promise we made to the candidate; undeliverable is Meta telling us
 * the number is dead (131026). Both are recorded as `skipped` rows rather than
 * quietly filtered out of the audience, so the report can answer "why did these
 * 40 people not get it" instead of showing a total that does not add up.
 */
export function skipReasonFor(lead: {
  phoneE164: string | null;
  whatsappOptedOutAt: Date | null;
  whatsappUndeliverableAt: Date | null;
}): SkipReason | null {
  if (lead.whatsappOptedOutAt) return "opted_out";
  if (lead.whatsappUndeliverableAt) return "undeliverable";
  if (!lead.phoneE164) return "no_phone";
  return null;
}

/**
 * Render one recipient's template variables.
 *
 * The map is `{"1": "{name}", "2": "{service}"}` — Meta numbers body variables
 * positionally, and the tokens are the CRM's existing merge fields, so a
 * broadcast reuses exactly the vocabulary the email and WhatsApp composers
 * already use rather than inventing a second one.
 */
export type AudienceLead = {
  candidateName: string;
  campaign?: string | null;
  service: { name: string } | null;
  qualification?: { label: string } | null;
  assignedTo: { username: string; leadPulseRole: { displayName: string; phone: string | null } | null } | null;
};

export function renderRecipientParams(
  variableMap: Record<string, string> | null | undefined,
  lead: AudienceLead,
): Record<string, string> {
  if (!variableMap) return {};

  // Flattened into the shape the shared merge-field builder speaks, so a
  // broadcast renders {name}/{service}/{consultant} identically to the email and
  // WhatsApp composers rather than growing a second, subtly different vocabulary.
  const vars = buildLeadMergeVars({
    candidateName: lead.candidateName,
    service: lead.service?.name ?? null,
    consultant: lead.assignedTo?.leadPulseRole?.displayName ?? lead.assignedTo?.username ?? null,
    consultantPhone: lead.assignedTo?.leadPulseRole?.phone ?? null,
    campaign: lead.campaign ?? null,
    qualification: lead.qualification?.label ?? null,
  });

  const out: Record<string, string> = {};
  for (const [slot, token] of Object.entries(variableMap)) {
    out[slot] = fillTemplate(token, vars);
  }
  return out;
}

const AUDIENCE_SELECT = {
  id: true,
  candidateName: true,
  phoneE164: true,
  campaign: true,
  whatsappOptedOutAt: true,
  whatsappUndeliverableAt: true,
  service: { select: { name: true } },
  qualification: { select: { label: true } },
  assignedTo: { select: { username: true, leadPulseRole: { select: { displayName: true, phone: true } } } },
} as const;

/** How many leads a segment currently matches — the preview count. */
export async function countSegment(segment: LeadFilterParams): Promise<number> {
  return prisma.lead.count({ where: buildLeadWhere(segment) });
}

/**
 * Freeze a segment into recipient rows.
 *
 * Runs in chunks so a large audience does not build one enormous statement, and
 * uses `skipDuplicates` so re-queuing a broadcast cannot double-insert anyone —
 * the `(broadcastId, leadId)` unique index is the real guarantee.
 */
export async function materialiseAudience(broadcastId: string): Promise<{ total: number; skipped: number }> {
  const broadcast = await prisma.waBroadcast.findUnique({
    where: { id: broadcastId },
    select: { id: true, segment: true, variableMap: true },
  });
  if (!broadcast) return { total: 0, skipped: 0 };

  const segment = (broadcast.segment ?? {}) as LeadFilterParams;
  const variableMap = (broadcast.variableMap ?? null) as Record<string, string> | null;

  const CHUNK = 500;
  let cursor: string | null = null;
  let total = 0;
  let skipped = 0;

  for (;;) {
    // Explicitly typed rather than spread inline: a conditional spread makes the
    // query's result type depend on `cursor`, which is itself assigned from that
    // result — TypeScript sees the cycle and gives up, inferring `any`.
    const page: { cursor?: { id: string }; skip?: number } = cursor ? { cursor: { id: cursor }, skip: 1 } : {};
    const leads = await prisma.lead.findMany({
      where: buildLeadWhere(segment),
      orderBy: { id: "asc" },
      take: CHUNK,
      ...page,
      select: AUDIENCE_SELECT,
    });
    if (leads.length === 0) break;
    cursor = leads[leads.length - 1].id;

    const rows: Prisma.WaBroadcastRecipientCreateManyInput[] = leads.map((lead) => {
      const skip = skipReasonFor(lead);
      if (skip) skipped++;
      return {
        broadcastId,
        leadId: lead.id,
        phoneE164: lead.phoneE164 ?? "",
        renderedParams: skip ? undefined : renderRecipientParams(variableMap, lead),
        status: skip ? "skipped" : "pending",
        skipReason: skip,
      };
    });

    const inserted = await prisma.waBroadcastRecipient.createMany({ data: rows, skipDuplicates: true });
    total += inserted.count;

    if (leads.length < CHUNK) break;
  }

  await prisma.waBroadcast.update({
    where: { id: broadcastId },
    data: { totalRecipients: total, skippedCount: skipped },
  });

  return { total, skipped };
}

export type DrainSummary = {
  broadcastsTouched: number;
  sent: number;
  failed: number;
  remaining: number;
  stoppedEarly: boolean;
};

/**
 * Send the next chunk of every broadcast that is due.
 *
 * Called from the cron and from an admin "send now" button. Safe to run
 * concurrently with itself: each recipient is claimed with a conditional update
 * (`status: pending` -> `sending`), so two runners cannot both take the same row.
 */
export async function drainBroadcasts(now: Date = new Date()): Promise<DrainSummary> {
  const summary: DrainSummary = { broadcastsTouched: 0, sent: 0, failed: 0, remaining: 0, stoppedEarly: false };

  const config = await getBroadcastConfig();
  if (!config.enabled) return summary;

  const deadline = Date.now() + DRAIN_TIME_BUDGET_MS;

  const due = await prisma.waBroadcast.findMany({
    where: {
      status: { in: ["scheduled", "sending"] },
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, templateName: true, status: true },
  });

  const provider = await getWaProvider();

  for (const broadcast of due) {
    if (Date.now() > deadline) {
      summary.stoppedEarly = true;
      break;
    }
    summary.broadcastsTouched++;

    if (broadcast.status === "scheduled") {
      await prisma.waBroadcast.update({
        where: { id: broadcast.id },
        data: { status: "sending", startedAt: now },
      });
    }

    const result = await drainOne(broadcast.id, broadcast.templateName, provider, config.batchSize, deadline);
    summary.sent += result.sent;
    summary.failed += result.failed;
    summary.remaining += result.remaining;
    if (result.stoppedEarly) {
      summary.stoppedEarly = true;
      break;
    }
  }

  return summary;
}

async function drainOne(
  broadcastId: string,
  templateName: string,
  provider: Awaited<ReturnType<typeof getWaProvider>>,
  batchSize: number,
  deadline: number,
): Promise<{ sent: number; failed: number; remaining: number; stoppedEarly: boolean }> {
  let sent = 0;
  let failed = 0;
  let stoppedEarly = false;

  const pending = await prisma.waBroadcastRecipient.findMany({
    where: { broadcastId, status: "pending" },
    orderBy: { id: "asc" },
    take: batchSize,
    select: { id: true, phoneE164: true, renderedParams: true },
  });

  for (const recipient of pending) {
    if (Date.now() > deadline) {
      stoppedEarly = true;
      break;
    }

    // Claim it. The conditional `status: "pending"` means two concurrent
    // runners cannot both take this row — the loser updates zero rows and skips.
    const claimed = await prisma.waBroadcastRecipient.updateMany({
      where: { id: recipient.id, status: "pending" },
      data: { status: "sending", attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    const result = await provider.sendTemplate({
      toE164: recipient.phoneE164,
      template: templateName,
      params: (recipient.renderedParams ?? {}) as Record<string, string>,
      endpointUrl: null,
    });

    if (result.ok) {
      sent++;
      await prisma.waBroadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          providerMessageId: result.providerMessageId,
          waStatus: "sent",
        },
      });
    } else {
      failed++;
      await prisma.waBroadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          waStatus: "failed",
          waErrorMessage: result.body.slice(0, 300),
        },
      });
    }

    if (INTER_SEND_DELAY_MS > 0) await sleep(INTER_SEND_DELAY_MS);
  }

  const remaining = await prisma.waBroadcastRecipient.count({ where: { broadcastId, status: "pending" } });

  // Counters are recomputed rather than incremented, so a crashed run cannot
  // leave the totals permanently wrong.
  const [sentTotal, failedTotal] = await Promise.all([
    prisma.waBroadcastRecipient.count({ where: { broadcastId, status: "sent" } }),
    prisma.waBroadcastRecipient.count({ where: { broadcastId, status: "failed" } }),
  ]);

  // A row still `sending` means a pass died mid-flight. It is deliberately NOT
  // reset to pending here: the provider may already have accepted it, and
  // re-sending a marketing message is worse than leaving one unsent. Requeueing
  // is an explicit admin action.
  const stuck = await prisma.waBroadcastRecipient.count({ where: { broadcastId, status: "sending" } });
  const done = remaining === 0 && stuck === 0;

  await prisma.waBroadcast.update({
    where: { id: broadcastId },
    data: {
      sentCount: sentTotal,
      failedCount: failedTotal,
      ...(done ? { status: "sent", completedAt: new Date() } : {}),
    },
  });

  if (done) logger.info("wa_broadcast_completed", { broadcastId, sent: sentTotal, failed: failedTotal });

  return { sent, failed, remaining, stoppedEarly };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
