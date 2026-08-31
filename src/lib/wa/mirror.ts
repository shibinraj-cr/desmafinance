/**
 * Storing inbound WhatsApp messages against the right lead.
 *
 * Mostly this module only WRITES what happened — it advances no pipeline stage
 * and sends nothing back. The one exception is deliberate: an inbound message
 * ENDS a running re-marketing campaign.
 *
 * That used to belong to Wabis, whose keyword flow called our inbound endpoint.
 * Once the drip sends through our own WABA there is no such flow, so without
 * this a candidate could answer and keep receiving touches telling them we had
 * not heard from them. Every inbound message arrives here, which makes this the
 * only place that can know.
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
import { computeDedupeKey } from "../crm";
import { waIdToE164 } from "./phone";
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
 * reason on the import path.
 *
 * OLDEST lead wins, and that is a deliberate product decision, not an artefact
 * of the query. One number can map to several leads here (re-enrollment creates
 * a new lead per service), but a number has exactly one WhatsApp thread, so the
 * thread must pick one. Binding to the oldest matches how a re-inquiry folds
 * onto the canonical record rather than the newest duplicate, and it never
 * moves — the conversation stays attached to the same lead for its whole life.
 *
 * The known cost, accepted: for a re-enrolled candidate the inbox's context rail
 * shows the original lead, which is usually already closed, rather than the
 * service the consultant is currently working. Binding to the most recently
 * active lead would fix the rail but make the link move as leads change, which
 * loses stable attribution. Stability was chosen.
 *
 * This choice does NOT affect consent or de-duplication: opt-out is stamped
 * across every lead sharing the number, and broadcasts claim numbers rather than
 * leads, both independent of which lead the thread points at.
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
  // `msg.from` is the provider's wa_id — already complete international. Read as
  // such, never through the CRM's domestic-default normaliser: that turns every
  // ten-digit foreign number (Singapore, Norway, Denmark, New Zealand, Iceland)
  // into a plausible Indian one, filing the sender's messages under whoever owns
  // it and addressing the reply to them. See waIdToE164.
  const phoneE164 = waIdToE164(msg.from);
  if (!phoneE164) return { ok: false, reason: "no_phone" };

  try {
    // Opt-out is applied FIRST — ahead of the replay guard below, and not gated
    // on a linked lead. It is idempotent (only rows not already opted out are
    // stamped), so applying it on a redelivery costs nothing. Applying it after
    // the guard would mean a "STOP" whose first delivery stored the message but
    // died before the opt-out could never be recovered: every redelivery would
    // short-circuit as a duplicate and the candidate would stay subscribed.
    // Consent is the one thing worth a redundant write.
    if (isOptOutMessage(msg.body)) {
      await optOutByPhone(phoneE164, msg.body ?? "", msg.occurredAt ?? new Date());
    }

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
      select: { id: true, leadId: true, assignedToId: true, lastMessageAt: true, lastInboundAt: true },
    });

    // Hand an ownerless thread to whoever owns the lead. Only when it has no
    // owner: a conversation can be deliberately passed to someone other than the
    // lead's consultant (the inbox allows exactly that), and re-stamping it on
    // every inbound message would silently undo that handover.
    //
    // This is the common case rather than an edge one — a stranger's first
    // message creates the thread AND the lead, and the lead is assigned minutes
    // later, so without this the thread would never reach anyone's queue.
    if (!conversation.assignedToId && lead?.assignedToId) {
      await prisma.waConversation
        .update({ where: { id: conversation.id }, data: { assignedToId: lead.assignedToId } })
        .catch(() => undefined);
    }

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

    // A reply ends a re-marketing campaign.
    //
    // Under Wabis this only ever happened because a keyword flow over there
    // called our inbound endpoint — so the moment Wabis is disconnected, nothing
    // would notice a candidate answering, and the drip would keep messaging
    // somebody who had already said yes. Every inbound message arrives here, so
    // here is where it belongs.
    //
    // Reached only on `stored`, never on a duplicate: a webhook redelivery must
    // not re-open and re-close a campaign. Best-effort, like every other write in
    // this function — a nurturing decision must never cost us the message.
    // Never for an opt-out. That same message was stamped as one thirty lines
    // above, and passing it on here would advance the lead to Follow-Up and
    // notify a consultant that they "replied and are back in Follow-Up" — so
    // somebody rings the person who just asked to be left alone. The opt-out
    // already stops the campaign; this call has nothing left to add.
    if (conversation.leadId && !isOptOutMessage(msg.body)) {
      const { handleRemarketingReply } = await import("../crm-remarketing");
      await handleRemarketingReply({
        leadId: conversation.leadId,
        phone: phoneE164,
        text: msg.body,
      }).catch(() => undefined);
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
 * Scoped to the NUMBER, not to one lead. A person is a phone here, but this CRM
 * holds several Lead rows per phone by design — re-enrollment copies phoneE164
 * onto a brand-new lead for each additional service, and duplicates are flagged
 * rather than rejected. Stamping only the conversation's lead would silence the
 * row the thread happens to point at (the OLDEST, per findLeadByPhone) while
 * leaving the newer one — the one most likely to sit in an active marketing
 * segment — fully subscribed. The candidate then gets a campaign they opted out
 * of, which is a consent breach, not a reporting glitch.
 *
 * Matched against both phone fields, since a candidate may write from the
 * alternate number they gave us.
 *
 * Only stamps rows not already opted out, so a repeated "STOP" neither rewrites
 * the date nor piles duplicate rows onto the timeline.
 */
async function optOutByPhone(phoneE164: string, text: string, occurredAt: Date): Promise<void> {
  try {
    const affected = await prisma.lead.findMany({
      where: {
        OR: [{ phoneE164 }, { altPhoneE164: phoneE164 }],
        whatsappOptedOutAt: null,
      },
      select: { id: true },
    });
    if (affected.length === 0) return;

    await prisma.lead.updateMany({
      where: { id: { in: affected.map((l) => l.id) } },
      data: { whatsappOptedOutAt: occurredAt },
    });

    for (const lead of affected) {
      await recordLeadActivity({
        leadId: lead.id,
        type: "FIELD_UPDATED",
        summary: "Opted out of WhatsApp marketing",
        metadata: { channel: "whatsapp", field: "whatsappOptedOutAt", phoneE164, text: text.slice(0, 200) },
      });
    }
  } catch (e) {
    logger.error("wa_mirror_optout_failed", {
      phoneE164,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Point a lead's WhatsApp thread at whoever now owns the lead.
 *
 * Called when a lead is assigned or reassigned. A conversation is keyed by
 * number, so it is found by the lead's link OR by either of the lead's numbers —
 * a thread that arrived before the lead was linked would otherwise be missed
 * precisely when this matters most.
 *
 * Best-effort by design: the mirror may be switched off, or there may be no
 * thread for this number, and neither is a reason to fail an assignment.
 */
export async function syncConversationAssignee(leadId: string, assigneeUserId: string | null): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { phoneE164: true, altPhoneE164: true },
    });

    const numbers = [lead?.phoneE164, lead?.altPhoneE164].filter((p): p is string => !!p);
    await prisma.waConversation.updateMany({
      where: { OR: [{ leadId }, ...(numbers.length ? [{ phoneE164: { in: numbers } }] : [])] },
      data: { assignedToId: assigneeUserId },
    });
  } catch (e) {
    logger.warn("wa_sync_conversation_assignee_failed", {
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

export type FindOrCreateConversationResult =
  | { ok: true; conversationId: string }
  /** `phoneE164` is already a thread on a DIFFERENT lead — refuse rather than steal it. */
  | { ok: false; reason: "linked_elsewhere"; otherLeadId: string };

/**
 * The conversation a consultant is about to send the FIRST outbound message
 * on. Every other write path in this file only ever touches a row an inbound
 * message already created; this is the one place the CRM originates a thread.
 *
 * Found the same way the read path finds one — by lead link, then by number
 * for an unlinked row — so a thread a stranger's earlier message already
 * created is claimed here rather than duplicated (`phoneE164` is unique,
 * so a blind create would just throw).
 */
export async function findOrCreateConversationForLead(lead: {
  id: string;
  phoneE164: string;
  assignedToId: string | null;
}): Promise<FindOrCreateConversationResult> {
  const existing = await prisma.waConversation.findFirst({
    where: { OR: [{ leadId: lead.id }, { phoneE164: lead.phoneE164, leadId: null }] },
    select: { id: true, leadId: true },
  });
  if (existing) {
    if (existing.leadId && existing.leadId !== lead.id) {
      return { ok: false, reason: "linked_elsewhere", otherLeadId: existing.leadId };
    }
    if (!existing.leadId) {
      await prisma.waConversation.update({
        where: { id: existing.id },
        data: { leadId: lead.id, assignedToId: lead.assignedToId },
      });
    }
    return { ok: true, conversationId: existing.id };
  }

  // A number that already belongs to a thread on another lead (re-enrollment,
  // most likely) fails the unique constraint here rather than earlier, since
  // the `existing` lookup above only checks rows linked to THIS lead or
  // unlinked ones — this is the same "linked elsewhere" case, just caught late.
  try {
    const created = await prisma.waConversation.create({
      data: { phoneE164: lead.phoneE164, leadId: lead.id, assignedToId: lead.assignedToId, status: "open" },
      select: { id: true },
    });
    return { ok: true, conversationId: created.id };
  } catch {
    const other = await prisma.waConversation.findUnique({
      where: { phoneE164: lead.phoneE164 },
      select: { leadId: true },
    });
    return { ok: false, reason: "linked_elsewhere", otherLeadId: other?.leadId ?? lead.id };
  }
}
