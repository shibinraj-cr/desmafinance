/**
 * Storing inbound WhatsApp messages against the right lead.
 *
 * Phase 1 of moving the shared inbox into the CRM, and deliberately the boring
 * half: this module only WRITES what happened. It advances no pipeline stage,
 * ends no campaign and sends nothing back. The re-marketing reply path
 * (handleRemarketingReply) keeps running exactly as it does today, through its
 * own endpoint, so deploying the mirror changes no live automation — it just
 * means the conversation is finally readable from the CRM.
 *
 * Widening the reply rule ("any reply advances", not just a keyword-matched one)
 * becomes possible the moment every message lands here, but that is a behaviour
 * change and belongs to its own commit.
 *
 * Two rules carry the correctness of this file:
 *
 *   - **Idempotency.** Webhooks get re-delivered — on any non-2xx, and sometimes
 *     on a slow 2xx. Every write is therefore replayable: messages collide on the
 *     unique `providerMessageId` instead of duplicating. A provider that sends no
 *     id (Wabis workflows do not) cannot be deduped at all, which is stated here
 *     rather than papered over.
 *   - **Never lose a message.** A message whose lead cannot be resolved is still
 *     stored, on a lead-less conversation. Attribution can be fixed later; a
 *     dropped message is gone.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { normalizePhone, computeDedupeKey } from "../crm";
import { recordLeadActivity } from "../crm-activity";
import { resolveDefaultStatus } from "../crm-leads";
import { logger } from "../logger";
import {
  getSetting,
  WA_MIRROR_AUTOCREATE_KEY,
  WA_MIRROR_ENABLED_KEY,
  WA_PROVIDER_KEY,
} from "../app-settings";
import { isOptOutMessage, type WaInboundMessage } from "./inbound";
import type { WaProviderKey } from "./provider";

/** Source master an auto-created lead is attributed to (see prisma/seed-lead-pulse.ts). */
export const WA_INBOUND_SOURCE_CODE = "whatsapp_inbound";

/**
 * WhatsApp's free-text window. A business may only reply in plain text within 24
 * hours of the candidate's last inbound message; outside it, an approved
 * template is the only legal send. Stored as `sessionExpiresAt` so the composer
 * can gate on an indexed column instead of recomputing per row.
 */
export const WA_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type WaMirrorConfig = {
  enabled: boolean;
  autoCreateLeads: boolean;
  provider: WaProviderKey;
};

export async function getWaMirrorConfig(): Promise<WaMirrorConfig> {
  const [enabled, autoCreate, provider] = await Promise.all([
    getSetting(WA_MIRROR_ENABLED_KEY).catch(() => null),
    getSetting(WA_MIRROR_AUTOCREATE_KEY).catch(() => null),
    getSetting(WA_PROVIDER_KEY).catch(() => null),
  ]);
  return {
    enabled: enabled === "1",
    // Defaults ON: an unknown number messaging us is an inbound lead, and losing
    // those is the gap the Wabis keyword flow could never close. Only an explicit
    // "0" turns it off.
    autoCreateLeads: autoCreate !== "0",
    provider: provider?.trim() === "cloud" ? "cloud" : "wabis",
  };
}

/** `lastInboundAt + 24h` — exported so the composer and the tests agree on it. */
export function sessionExpiryFrom(lastInboundAt: Date): Date {
  return new Date(lastInboundAt.getTime() + WA_SESSION_WINDOW_MS);
}

/** Whether free text is still legal on a thread at `now`. */
export function isSessionOpen(sessionExpiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !!sessionExpiresAt && sessionExpiresAt.getTime() > now.getTime();
}

export type WaIngestOutcome =
  | { ok: true; action: "stored"; conversationId: string; leadId: string | null; leadCreated: boolean }
  | { ok: true; action: "duplicate"; conversationId: string; leadId: string | null }
  | { ok: false; reason: "no_phone" | "error" };

export type WaIngestSummary = {
  received: number;
  stored: number;
  duplicates: number;
  leadsCreated: number;
  /** Unusable and never will be — no sendable number. Retrying cannot help. */
  skipped: number;
  /**
   * Storage genuinely failed. Kept apart from `skipped` because the two want
   * opposite answers to the provider: a skip is final, a failure should be
   * redelivered. The route turns a non-zero value here into a non-2xx.
   */
  failed: number;
};

/**
 * Resolve the candidate this number belongs to.
 *
 * Matched against BOTH phone fields because a candidate may well message from
 * the alternate number they gave us — `phoneMatchKeys` exists for the same
 * reason on the import path. Oldest lead wins, matching how a re-inquiry folds
 * onto the canonical record rather than the newest duplicate.
 */
async function findLeadByPhone(phoneE164: string) {
  return prisma.lead.findFirst({
    where: { OR: [{ phoneE164 }, { altPhoneE164: phoneE164 }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, assignedToId: true },
  });
}

/**
 * Idempotency key for an auto-created inbound lead.
 *
 * `Lead.externalKey` is unique and exists precisely for "stable per-source-row
 * key for idempotent external ingestion". Deriving it from the number makes lead
 * creation race-safe at the DATABASE, which matters because `phoneE164` is only
 * a plain index here — deliberately, since this CRM flags duplicates rather than
 * rejecting them.
 */
export function waInboundExternalKey(phoneE164: string): string {
  return `wa:${phoneE164}`;
}

/**
 * Create a lead for a number that messaged us out of the blue.
 *
 * Named from the number itself — we genuinely do not know who this is yet, and a
 * placeholder that looks like a name ("WhatsApp Lead") reads worse in a list than
 * the number a BDE can actually call. Returns null when the CRM has no statuses
 * configured, since a lead without a stage cannot exist.
 *
 * Race-safe by construction. Two messages from an unseen number can be delivered
 * as two concurrent requests, and a plain create would then have both pass the
 * "does a lead exist" check and both insert — one candidate, two leads, doubled
 * source-funnel counts, and the conversation attached to only one of them. So
 * this uses the same idiom crm-sheet-ingest.ts documents as "race-safe against
 * the unique externalKey": insert with skipDuplicates, then read back by that
 * key. The loser of the race gets the winner's lead instead of a second one.
 */
async function createInboundLead(
  phoneE164: string,
): Promise<{ lead: { id: string; assignedToId: string | null }; created: boolean } | null> {
  const [defStatus, source] = await Promise.all([
    resolveDefaultStatus(),
    prisma.leadPulseSource.findUnique({ where: { code: WA_INBOUND_SOURCE_CODE }, select: { id: true } }),
  ]);
  if (!defStatus) return null;

  const externalKey = waInboundExternalKey(phoneE164);
  const inserted = await prisma.lead.createMany({
    data: [
      {
        candidateName: phoneE164,
        phone: phoneE164,
        phoneE164,
        dedupeKey: computeDedupeKey(null, phoneE164),
        externalKey,
        statusId: defStatus.id,
        sourceId: source?.id ?? null,
      },
    ],
    skipDuplicates: true,
  });

  const lead = await prisma.lead.findUnique({
    where: { externalKey },
    select: { id: true, assignedToId: true },
  });
  if (!lead) return null;

  // Only the request that actually inserted writes the activity, so a lost race
  // does not put a second "Created from…" row on one lead's timeline.
  if (inserted.count > 0) {
    await recordLeadActivity({
      leadId: lead.id,
      type: "LEAD_CREATED",
      summary: "Created from an inbound WhatsApp message",
      metadata: { channel: "whatsapp", phoneE164 },
    });
  }

  return { lead, created: inserted.count > 0 };
}

/**
 * Store one inbound message, creating the thread (and possibly the lead) around
 * it. Safe to call twice with the same message.
 */
export async function ingestInboundMessage(
  msg: WaInboundMessage,
  config: WaMirrorConfig,
): Promise<WaIngestOutcome> {
  const phoneE164 = normalizePhone(msg.from);
  if (!phoneE164) return { ok: false, reason: "no_phone" };

  try {
    // A redelivery must be a true no-op, and "don't insert the message" is not
    // enough on its own: the upsert below also re-opens the thread and re-links
    // the lead, so a replayed message would quietly re-open a conversation
    // someone had deliberately closed. Checked first, because everything after
    // this point writes.
    if (msg.providerMessageId) {
      const seen = await prisma.waMessage.findUnique({
        where: { providerMessageId: msg.providerMessageId },
        select: { conversation: { select: { id: true, leadId: true } } },
      });
      if (seen) {
        return {
          ok: true,
          action: "duplicate",
          conversationId: seen.conversation.id,
          leadId: seen.conversation.leadId,
        };
      }
    }

    // A provider that echoes our own lead_id is more reliable than a phone
    // lookup — it survives a candidate whose number we later corrected.
    let lead = msg.leadId
      ? await prisma.lead.findUnique({ where: { id: msg.leadId }, select: { id: true, assignedToId: true } })
      : null;
    if (!lead) lead = await findLeadByPhone(phoneE164);

    let leadCreated = false;
    if (!lead && config.autoCreateLeads) {
      const result = await createInboundLead(phoneE164);
      lead = result?.lead ?? null;
      // False when we lost the create race and adopted the winner's lead — the
      // summary counts leads that came into existence, not lookups that succeeded.
      leadCreated = result?.created ?? false;
    }

    const occurredAt = msg.occurredAt ?? new Date();
    const sessionExpiresAt = sessionExpiryFrom(occurredAt);

    // One thread per number. Upsert rather than find-then-create so two webhook
    // deliveries racing on a brand-new number cannot both create it.
    //
    // Counters and timestamps are deliberately NOT set here: they belong to the
    // update below, which runs only once the message is known to be new. Setting
    // them on create too would double-count the first message of every thread.
    const conversation = await prisma.waConversation.upsert({
      where: { phoneE164 },
      create: {
        phoneE164,
        leadId: lead?.id ?? null,
        assignedToId: lead?.assignedToId ?? null,
        status: "open",
      },
      update: {
        // Backfill the link if the lead only appeared after the thread did, and
        // re-open a thread someone had closed — a candidate writing again is the
        // clearest possible signal that it is not finished.
        ...(lead ? { leadId: lead.id } : {}),
        status: "open",
      },
      select: { id: true, leadId: true, lastMessageAt: true, lastInboundAt: true },
    });

    const created = await prisma.waMessage.createMany({
      data: [
        {
          conversationId: conversation.id,
          direction: "in",
          type: msg.type,
          body: msg.body,
          mediaId: msg.mediaId,
          mediaMime: msg.mediaMime,
          fileName: msg.fileName,
          providerMessageId: msg.providerMessageId,
          provider: config.provider,
          occurredAt,
        },
      ],
      // Backstop for the check above losing a race with a concurrent redelivery:
      // collides on the unique providerMessageId instead of throwing. A message
      // with no id cannot collide and is always stored — a possible duplicate
      // beats a lost message.
      skipDuplicates: true,
    });

    if (created.count === 0) {
      return { ok: true, action: "duplicate", conversationId: conversation.id, leadId: conversation.leadId };
    }

    // Counters are updated only for a message we actually stored, so a redelivery
    // cannot inflate the unread badge or drag the session window forward.
    const timestamps = advanceTimestamps(conversation, occurredAt, sessionExpiresAt);
    await prisma.waConversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: { increment: 1 },
        ...timestamps,
        // Only a message that is genuinely the NEWEST on the thread means nobody
        // has answered. A replayed or backlogged message that lands behind an
        // outbound reply must not resurrect the needs-reply flag — and the
        // timestamp patch already encodes "was this the newest": it is empty
        // when the message did not move the thread's clock forward.
        ...(timestamps.lastInboundAt ? { awaitingReply: true } : {}),
      },
    });

    // An opt-out is the one inbound message that changes the lead itself. It is
    // recorded on the timeline BECAUSE it is rare and consequential — the exact
    // opposite of the ordinary chatter deliberately kept off it — and every
    // future broadcast then skips this candidate (see skipReasonFor).
    if (conversation.leadId && isOptOutMessage(msg.body)) {
      await optOutLead(conversation.leadId, msg.body ?? "", occurredAt);
    }

    // An inbound message is real activity: it must bump the lead out of the
    // stale-lead bucket. Deliberately no LeadActivity row per message — the
    // timeline is a summary of what was DONE, and a chatty thread would bury it.
    //
    // Forward-only, for the same reason the conversation's clock is: this field
    // backs the leads list's "Recent activity" sort, every other writer stamps
    // `new Date()`, and so it has always been monotonic. A replayed or backlogged
    // message carrying an old `occurredAt` must not drag a lead backwards past
    // newer, genuine work.
    if (conversation.leadId) {
      await prisma.lead
        .updateMany({
          where: { id: conversation.leadId, lastActivityAt: { lt: occurredAt } },
          data: { lastActivityAt: occurredAt },
        })
        .catch(() => undefined);
    }

    return {
      ok: true,
      action: "stored",
      conversationId: conversation.id,
      leadId: conversation.leadId,
      leadCreated,
    };
  } catch (e) {
    // Structured, not console.error — this is the one outcome where a message we
    // accepted did NOT get stored, so it has to be findable in the logs. The
    // caller turns this into a non-2xx so the provider redelivers; answering 200
    // here would quietly drop the message, which is the one thing this module
    // promises never to do.
    logger.error("wa_mirror_ingest_failed", {
      phoneE164,
      providerMessageId: msg.providerMessageId,
      message: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, reason: "error" };
  }
}

/**
 * Only ever move `lastMessageAt` / `lastInboundAt` / `sessionExpiresAt` forward.
 *
 * Webhook redelivery and outage catch-up both replay old messages out of order.
 * Letting one rewind the session window would silently re-open a 24-hour reply
 * window that has actually closed, and the composer would then offer free text
 * that Meta rejects — so the guard is here rather than at the UI.
 *
 * Pure, so the ordering rule is directly testable.
 */
export function advanceTimestamps(
  current: { lastMessageAt: Date | null; lastInboundAt: Date | null },
  occurredAt: Date,
  sessionExpiresAt: Date,
): Prisma.WaConversationUpdateInput {
  const patch: Prisma.WaConversationUpdateInput = {};
  if (!current.lastMessageAt || current.lastMessageAt < occurredAt) patch.lastMessageAt = occurredAt;
  if (!current.lastInboundAt || current.lastInboundAt < occurredAt) {
    patch.lastInboundAt = occurredAt;
    patch.sessionExpiresAt = sessionExpiresAt;
  }
  return patch;
}

/** Store a batch, one at a time so a single bad message cannot lose the rest. */
export async function ingestInboundMessages(
  messages: readonly WaInboundMessage[],
  config: WaMirrorConfig,
): Promise<WaIngestSummary> {
  const summary: WaIngestSummary = {
    received: messages.length,
    stored: 0,
    duplicates: 0,
    leadsCreated: 0,
    skipped: 0,
    failed: 0,
  };

  for (const msg of messages) {
    const outcome = await ingestInboundMessage(msg, config);
    if (!outcome.ok) {
      if (outcome.reason === "error") summary.failed++;
      else summary.skipped++;
    } else if (outcome.action === "duplicate") summary.duplicates++;
    else {
      summary.stored++;
      if (outcome.leadCreated) summary.leadsCreated++;
    }
  }

  return summary;
}

/**
 * Record that a candidate asked to stop receiving marketing.
 *
 * Only stamped once — `whatsappOptedOutAt: null` in the where — so a second
 * "STOP" does not keep rewriting the date or pile duplicate rows onto the
 * timeline. Best-effort like the rest of this module: failing to record an
 * opt-out must not cost us the message, though it is logged loudly because the
 * consequence of losing one is messaging someone who asked us not to.
 */
async function optOutLead(leadId: string, text: string, occurredAt: Date): Promise<void> {
  try {
    const updated = await prisma.lead.updateMany({
      where: { id: leadId, whatsappOptedOutAt: null },
      data: { whatsappOptedOutAt: occurredAt },
    });
    if (updated.count === 0) return;

    await recordLeadActivity({
      leadId,
      type: "FIELD_UPDATED",
      summary: "Opted out of WhatsApp marketing",
      metadata: { channel: "whatsapp", field: "whatsappOptedOutAt", text: text.slice(0, 200) },
    });
  } catch (e) {
    logger.error("wa_mirror_optout_failed", {
      leadId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Clear the unread badge when a CRM user opens the thread. */
export async function markConversationRead(conversationId: string): Promise<void> {
  await prisma.waConversation
    .update({ where: { id: conversationId }, data: { unreadCount: 0 } })
    .catch(() => undefined);
}
