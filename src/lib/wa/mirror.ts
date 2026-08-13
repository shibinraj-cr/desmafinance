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
import {
  getSetting,
  WA_MIRROR_AUTOCREATE_KEY,
  WA_MIRROR_ENABLED_KEY,
  WA_PROVIDER_KEY,
} from "../app-settings";
import type { WaInboundMessage } from "./inbound";
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
  skipped: number;
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
 * Create a lead for a number that messaged us out of the blue.
 *
 * Named from the number itself — we genuinely do not know who this is yet, and a
 * placeholder that looks like a name ("WhatsApp Lead") reads worse in a list than
 * the number a BDE can actually call. Returns null when the CRM has no statuses
 * configured, since a lead without a stage cannot exist.
 */
async function createInboundLead(phoneE164: string): Promise<{ id: string; assignedToId: string | null } | null> {
  const [defStatus, source] = await Promise.all([
    resolveDefaultStatus(),
    prisma.leadPulseSource.findUnique({ where: { code: WA_INBOUND_SOURCE_CODE }, select: { id: true } }),
  ]);
  if (!defStatus) return null;

  const lead = await prisma.lead.create({
    data: {
      candidateName: phoneE164,
      phone: phoneE164,
      phoneE164,
      dedupeKey: computeDedupeKey(null, phoneE164),
      statusId: defStatus.id,
      sourceId: source?.id ?? null,
    },
    select: { id: true, assignedToId: true },
  });

  await recordLeadActivity({
    leadId: lead.id,
    type: "LEAD_CREATED",
    summary: "Created from an inbound WhatsApp message",
    metadata: { channel: "whatsapp", phoneE164 },
  });

  return lead;
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
      lead = await createInboundLead(phoneE164);
      leadCreated = !!lead;
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
    await prisma.waConversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: { increment: 1 },
        ...advanceTimestamps(conversation, occurredAt, sessionExpiresAt),
      },
    });

    // An inbound message is real activity: it must bump the lead out of the
    // stale-lead bucket. Deliberately no LeadActivity row per message — the
    // timeline is a summary of what was DONE, and a chatty thread would bury it.
    if (conversation.leadId) {
      await prisma.lead
        .update({ where: { id: conversation.leadId }, data: { lastActivityAt: occurredAt } })
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
    console.error("[wa-mirror] ingestInboundMessage failed:", e);
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
  };

  for (const msg of messages) {
    const outcome = await ingestInboundMessage(msg, config);
    if (!outcome.ok) summary.skipped++;
    else if (outcome.action === "duplicate") summary.duplicates++;
    else {
      summary.stored++;
      if (outcome.leadCreated) summary.leadsCreated++;
    }
  }

  return summary;
}

/** Clear the unread badge when a CRM user opens the thread. */
export async function markConversationRead(conversationId: string): Promise<void> {
  await prisma.waConversation
    .update({ where: { id: conversationId }, data: { unreadCount: 0 } })
    .catch(() => undefined);
}
