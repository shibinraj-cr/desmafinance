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

/**
 * Recipients per drain run, unless an admin overrides it via `wa_broadcast_batch`.
 * The ceiling is a guard, not a throughput promise: the wall-clock budget below
 * (and Meta's per-24h messaging tier) cap what actually goes out in a run, so a
 * value far above what fits in the budget simply spills to the next run.
 */
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1000;

/**
 * Wall-clock budget for one drain pass. Vercel kills the request at 60s, and a
 * kill mid-send is the one thing that can lose a message: the provider may have
 * accepted it while our row still says `pending`, and the next run would send
 * again. Stopping early with time to spare keeps that window closed.
 */
const DRAIN_TIME_BUDGET_MS = 45_000;

/** Meta rate-limits template sends; a small gap keeps a burst from tripping it. */
const INTER_SEND_DELAY_MS = 120;

/**
 * How many times one recipient may be retried after a transient failure before
 * it is called failed. Without a ceiling a permanently-misclassified error would
 * keep a campaign cycling forever.
 */
const MAX_SEND_ATTEMPTS = 3;

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

/** Why a lead in the segment will not be messaged. */
export type SkipReason = "no_phone" | "opted_out" | "undeliverable" | "duplicate_number" | "cancelled";

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

/**
 * Meta error codes that mean the NUMBER cannot receive WhatsApp at all, so a
 * broadcast that hits one flags the lead and every later broadcast + the
 * re-marketing drip skip it. Deliberately narrow: only 131026 ("not on WhatsApp /
 * invalid number") is a true dead-number verdict. Transient/window codes (131000
 * generic, 131047 24h re-engagement, 131049 frequency cap) are NOT here — flagging
 * a valid lead undeliverable over one of those would silence it forever.
 */
const PERMANENT_UNDELIVERABLE_CODES: ReadonlySet<string> = new Set(["131026"]);

/**
 * The audience where-clause. `buildLeadWhere` for the stage/service/source
 * filters, PLUS an optional "engaged" gate: only leads on a number that MESSAGED
 * US within N days. This is the single biggest deliverability lever — a marketing
 * template to people who have replied lands, whereas the same to a cold list is
 * throttled/blocked by Meta.
 *
 * The gate is by PHONE, not by the lead→conversation relation: a thread is keyed
 * by phone (unique) and linked to whichever lead is oldest, so gating on the
 * relation would drop re-enrolled sibling leads that share an engaged number.
 * Async because it first reads the set of engaged numbers.
 */
export async function broadcastLeadWhere(segment: LeadFilterParams): Promise<Prisma.LeadWhereInput> {
  const where = buildLeadWhere(segment);
  const days = Number((segment as { engagedWithinDays?: unknown }).engagedWithinDays);
  if (Number.isFinite(days) && days > 0) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const engaged = await prisma.waConversation.findMany({
      where: { lastInboundAt: { gte: cutoff } },
      select: { phoneE164: true },
    });
    // An empty set correctly matches nobody (nobody engaged in the window).
    where.phoneE164 = { in: engaged.map((c) => c.phoneE164) };
  }
  return where;
}

/** How many leads a segment currently matches — the preview count. */
export async function countSegment(segment: LeadFilterParams): Promise<number> {
  return prisma.lead.count({ where: await broadcastLeadWhere(segment) });
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
  // Resolve the audience where ONCE (the engaged gate reads a set of numbers) and
  // reuse it for every chunk, so the frozen list matches the preview exactly.
  const where = await broadcastLeadWhere(segment);

  const CHUNK = 500;
  let cursor: string | null = null;
  let total = 0;
  let skipped = 0;

  // Numbers already given a PENDING row in this broadcast. One person is one
  // phone, but several Lead rows can share it (re-enrollment copies the number
  // onto a new lead per service), and the unique index is (broadcastId, leadId)
  // — so without this the same handset receives the identical campaign twice.
  // Seeded from what is already stored so an interrupted run resumes correctly.
  const claimedNumbers = new Set(
    (
      await prisma.waBroadcastRecipient.findMany({
        where: { broadcastId, status: "pending" },
        select: { phoneE164: true },
      })
    ).map((r) => r.phoneE164),
  );

  for (;;) {
    // Explicitly typed rather than spread inline: a conditional spread makes the
    // query's result type depend on `cursor`, which is itself assigned from that
    // result — TypeScript sees the cycle and gives up, inferring `any`.
    const page: { cursor?: { id: string }; skip?: number } = cursor ? { cursor: { id: cursor }, skip: 1 } : {};
    const leads = await prisma.lead.findMany({
      where,
      orderBy: { id: "asc" },
      take: CHUNK,
      ...page,
      select: AUDIENCE_SELECT,
    });
    if (leads.length === 0) break;
    cursor = leads[leads.length - 1].id;

    const rows: Prisma.WaBroadcastRecipientCreateManyInput[] = leads.map((lead) => {
      let skip = skipReasonFor(lead);
      // A second lead on a number already claimed by this campaign still gets a
      // row — recorded, not silently dropped, so the report accounts for every
      // lead the segment matched — but it is not sent to.
      if (!skip && lead.phoneE164 && claimedNumbers.has(lead.phoneE164)) skip = "duplicate_number";
      if (!skip && lead.phoneE164) claimedNumbers.add(lead.phoneE164);
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

    // Counters are written per chunk, not once at the end. A lambda killed
    // mid-loop leaves the inserted rows committed, and a broadcast still showing
    // totalRecipients 0 would look like an empty campaign that the drain then
    // marks complete — stranding an audience that is really sitting there.
    await prisma.waBroadcast.update({
      where: { id: broadcastId },
      data: { totalRecipients: total, skippedCount: skipped },
    });

    if (leads.length < CHUNK) break;
  }

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
    select: {
      id: true,
      leadId: true,
      phoneE164: true,
      renderedParams: true,
      // Re-read at SEND time, not trusted from materialisation. A campaign on
      // this plan drains over days, and a candidate who taps STOP on day two
      // must not receive day three's chunk — the audience is frozen, but consent
      // is not part of the audience.
      lead: { select: { whatsappOptedOutAt: true, whatsappUndeliverableAt: true } },
    },
  });

  for (const recipient of pending) {
    if (Date.now() > deadline) {
      stoppedEarly = true;
      break;
    }

    const nowSkip = recipient.lead ? skipReasonFor({ ...recipient.lead, phoneE164: recipient.phoneE164 }) : null;
    if (nowSkip) {
      await prisma.waBroadcastRecipient.updateMany({
        where: { id: recipient.id, status: "pending" },
        data: { status: "skipped", skipReason: nowSkip },
      });
      continue;
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
    } else if (result.retryable) {
      // A rate limit or a dropped connection says nothing about this recipient.
      // Back to `pending` so a later run tries again — `attempts` already
      // incremented, and MAX_ATTEMPTS below stops it looping forever.
      const giveUp = await prisma.waBroadcastRecipient.findUnique({
        where: { id: recipient.id },
        select: { attempts: true },
      });
      const exhausted = (giveUp?.attempts ?? 0) >= MAX_SEND_ATTEMPTS;
      if (exhausted) failed++;
      await prisma.waBroadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: exhausted ? "failed" : "pending",
          ...(exhausted ? { waStatus: "failed" } : {}),
          waErrorCode: result.errorCode ?? null,
          waErrorMessage: result.body.slice(0, 300),
        },
      });
      if (!exhausted) stoppedEarly = true; // a rate limit means back off now, not harder
      if (!exhausted) break;
    } else {
      failed++;
      await prisma.waBroadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          waStatus: "failed",
          waErrorCode: result.errorCode ?? null,
          waErrorMessage: result.body.slice(0, 300),
        },
      });
      // A permanently-undeliverable number (131026 not on WhatsApp) is a property
      // of the PHONE, not this campaign or this lead row: flag every lead sharing
      // the number (re-enrollment copies it per service) so every later broadcast
      // AND the re-marketing drip skip it, instead of re-hitting a dead number.
      if (recipient.phoneE164 && result.errorCode && PERMANENT_UNDELIVERABLE_CODES.has(result.errorCode)) {
        await prisma.lead
          .updateMany({
            where: { phoneE164: recipient.phoneE164, whatsappUndeliverableAt: null },
            data: { whatsappUndeliverableAt: new Date(), whatsappUndeliverableReason: result.errorCode },
          })
          .catch(() => undefined);
      }
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

  // Counters are safe to write unconditionally; STATUS is not. An admin can
  // cancel while a drain is mid-batch, and an unconditional `status: "sent"`
  // would resurrect the cancelled campaign as a completed one — telling the
  // team a send finished that they had deliberately stopped. So completion only
  // applies to a broadcast still in flight.
  await prisma.waBroadcast.update({
    where: { id: broadcastId },
    data: { sentCount: sentTotal, failedCount: failedTotal },
  });

  if (done) {
    await prisma.waBroadcast.updateMany({
      where: { id: broadcastId, status: { in: ["scheduled", "sending"] } },
      data: { status: "sent", completedAt: new Date() },
    });
  }

  if (done) logger.info("wa_broadcast_completed", { broadcastId, sent: sentTotal, failed: failedTotal });

  return { sent, failed, remaining, stoppedEarly };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
