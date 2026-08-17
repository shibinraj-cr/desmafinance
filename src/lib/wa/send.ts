/**
 * Sending a WhatsApp message from the CRM.
 *
 * The rule that shapes this file is WhatsApp's, not ours: a business may send
 * free text only within 24 hours of the candidate's last inbound message, and
 * outside that window an approved template is the only legal send. Meta rejects
 * the illegal case, so the choice is between finding out at their API or
 * deciding here. Deciding here means the composer can tell a consultant what
 * they may write BEFORE they type it.
 *
 * The window is extended by INBOUND messages only. Sending does not buy more
 * time — a business that could reopen its own window by messaging would make
 * the rule meaningless — so this module never touches `lastInboundAt` or
 * `sessionExpiresAt`, only `lastMessageAt`.
 *
 * Delivery is recorded optimistically as `sent`: that is our transport verdict,
 * not Meta's. Whether the message was delivered, read, or bounced arrives later
 * on the status webhook and overwrites `waStatus` — the same two-layer split
 * CrmWebhookDelivery already uses.
 */
import { prisma } from "../prisma";
import { recordLeadActivity } from "../crm-activity";
import { logger } from "../logger";
import { getWaProvider } from "./registry";
import { isSessionOpen } from "./mirror";

/** Longest single WhatsApp text message; Meta rejects anything above this. */
export const WA_MAX_TEXT_LENGTH = 4096;

export type WaSendOutcome =
  | { ok: true; messageId: string; providerMessageId: string | null }
  | {
      ok: false;
      /**
       * `session_closed`  — free text outside the 24h window (send a template),
       * `unsupported`     — the live transport cannot do this at all,
       * `no_conversation` — nothing to reply to,
       * `send_failed`     — the provider rejected or the request never landed.
       */
      reason: "session_closed" | "unsupported" | "no_conversation" | "send_failed";
      detail: string;
    };

export type WaSendInput = {
  conversationId: string;
  /** Author. Null only for an automation; every CRM-initiated send has one. */
  sentById: string | null;
  /** Free text. Requires an open session. */
  body?: string | null;
  /** Approved template name. Always legal, in or out of the window. */
  template?: string | null;
  templateParams?: Record<string, string>;
  /**
   * The template's header + body with `templateParams` already filled in —
   * what the candidate actually receives. Display-only: it is never sent to
   * the provider (that's `template` + `templateParams`), only persisted so
   * the thread shows real content instead of the template's technical name.
   */
  renderedBody?: string | null;
};

/**
 * Send one message on a conversation and record it on the thread.
 *
 * Authorisation is the CALLER's job — this module does not know who is asking.
 * The route gates on canEditLead before getting here.
 */
export async function sendWaMessage(input: WaSendInput): Promise<WaSendOutcome> {
  const conversation = await prisma.waConversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, phoneE164: true, leadId: true, sessionExpiresAt: true },
  });
  if (!conversation) return { ok: false, reason: "no_conversation", detail: "Conversation not found" };

  const template = input.template?.trim() || null;
  const body = input.body?.trim() || null;

  if (!template && !body) {
    return { ok: false, reason: "send_failed", detail: "Nothing to send" };
  }
  // Only one of the two actually goes out, so accepting both would record free
  // text on the thread — and on the lead's timeline — that the candidate never
  // received. Rejecting beats silently discarding one of them.
  if (template && body) {
    return { ok: false, reason: "send_failed", detail: "Send either a message or a template, not both" };
  }
  if (body && body.length > WA_MAX_TEXT_LENGTH) {
    return { ok: false, reason: "send_failed", detail: `Message exceeds ${WA_MAX_TEXT_LENGTH} characters` };
  }

  // The gate. A template is always legal; free text is not, and the window is
  // checked here rather than trusted from the client — a stale tab is exactly
  // the case where the UI thinks the session is open and it has since lapsed.
  const sessionOpen = isSessionOpen(conversation.sessionExpiresAt);
  if (!template && !sessionOpen) {
    return {
      ok: false,
      reason: "session_closed",
      detail: "The 24-hour reply window has closed — send an approved template instead",
    };
  }

  const provider = await getWaProvider();
  const result = template
    ? await provider.sendTemplate({
        toE164: conversation.phoneE164,
        template,
        params: input.templateParams ?? {},
        endpointUrl: null,
      })
    : await provider.sendText({ toE164: conversation.phoneE164, body: body! });

  if (!result.ok) {
    // `unsupported` is a capability gap, not a transport failure: retrying will
    // never help, and the consultant needs to be told to use Wabis (or that the
    // cutover is what unblocks them) rather than shown a generic error.
    if (result.unsupported) {
      return { ok: false, reason: "unsupported", detail: result.body };
    }
    logger.warn("wa_send_failed", {
      conversationId: conversation.id,
      status: result.status,
      template,
    });
    return { ok: false, reason: "send_failed", detail: result.body || "The message could not be sent" };
  }

  // Past this line the candidate HAS the message. Every failure below is a
  // bookkeeping failure, and must never be reported as a send failure: the
  // consultant would press Send again and the candidate would get it twice.
  const now = new Date();
  try {
    return await recordSentMessage(conversation, input, template, body, result, provider.key, now);
  } catch (e) {
    logger.error("wa_send_persisted_failed", {
      conversationId: conversation.id,
      providerMessageId: result.providerMessageId,
      message: e instanceof Error ? e.message : String(e),
    });
    // Reported as success because it WAS a success. The thread will be missing a
    // row until the delivery-status webhook or the next inbound message repairs
    // it; that is strictly better than a duplicate send.
    return { ok: true, messageId: "", providerMessageId: result.providerMessageId };
  }
}

/**
 * Send a recorded voice note.
 *
 * Kept beside `sendWaMessage` rather than folded into it because the shapes do
 * not overlap: there is no template variant, nothing to length-check, and the
 * payload is bytes rather than a string. What it DOES share is the rule that
 * matters — a voice note is free-form, so the 24-hour window applies exactly as
 * it does to text, and no template escape hatch exists for it.
 *
 * The bytes are expected to be Ogg/Opus mono already; `remuxToOggOpus` is the
 * one place that is established, and this refuses to double-guess it.
 */
export async function sendWaVoiceNote(input: {
  conversationId: string;
  sentById: string;
  bytes: Uint8Array;
  /** False when the browser could only manage a format Meta treats as a file. */
  voice: boolean;
  mime: string;
}): Promise<WaSendOutcome> {
  const conversation = await prisma.waConversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, phoneE164: true, leadId: true, sessionExpiresAt: true },
  });
  if (!conversation) return { ok: false, reason: "no_conversation", detail: "Conversation not found" };

  if (!isSessionOpen(conversation.sessionExpiresAt)) {
    return {
      ok: false,
      reason: "session_closed",
      detail: "The 24-hour reply window has closed — send an approved template instead",
    };
  }

  const provider = await getWaProvider();
  if (!provider.supports("sendAudio")) {
    return { ok: false, reason: "unsupported", detail: `${provider.label} cannot send audio` };
  }

  const uploaded = await provider.uploadMedia({
    bytes: input.bytes,
    mime: input.mime,
    fileName: "voice-note.ogg",
  });
  if (!uploaded.ok) {
    // Nothing has reached the candidate yet, so this one IS safe to retry —
    // which is exactly why upload and send are separate calls.
    return {
      ok: false,
      reason: uploaded.unsupported ? "unsupported" : "send_failed",
      detail: uploaded.detail,
    };
  }

  const result = await provider.sendAudio({
    toE164: conversation.phoneE164,
    mediaId: uploaded.mediaId,
    voice: input.voice,
  });
  if (!result.ok) {
    if (result.unsupported) return { ok: false, reason: "unsupported", detail: result.body };
    logger.warn("wa_voice_send_failed", { conversationId: conversation.id, status: result.status });
    return { ok: false, reason: "send_failed", detail: result.body || "The voice note could not be sent" };
  }

  // Past this line the candidate HAS it — the same rule as text: a bookkeeping
  // failure must never be reported as a send failure, or it gets sent twice.
  const now = new Date();
  try {
    const message = await prisma.waMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "out",
        type: "audio",
        body: null,
        // Recorded so the thread can play back what we sent. Meta keeps uploaded
        // media for thirty days, after which this plays nothing — the same
        // archival question inbound media raises, and answered the same way for
        // now: not here.
        mediaId: uploaded.mediaId,
        mediaMime: input.mime,
        providerMessageId: result.providerMessageId,
        provider: provider.key,
        waStatus: "sent",
        sentById: input.sentById,
        occurredAt: now,
      },
      select: { id: true },
    });

    await prisma.waConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now, status: "open", awaitingReply: false },
    });

    if (conversation.leadId) {
      await recordLeadActivity({
        leadId: conversation.leadId,
        actorId: input.sentById,
        type: "WHATSAPP_SENT",
        summary: input.voice ? "WhatsApp voice note sent" : "WhatsApp audio sent",
        metadata: { channel: "whatsapp", via: "inbox", providerMessageId: result.providerMessageId },
      });
    }

    return { ok: true, messageId: message.id, providerMessageId: result.providerMessageId };
  } catch (e) {
    logger.error("wa_voice_persisted_failed", {
      conversationId: conversation.id,
      providerMessageId: result.providerMessageId,
      message: e instanceof Error ? e.message : String(e),
    });
    return { ok: true, messageId: "", providerMessageId: result.providerMessageId };
  }
}

async function recordSentMessage(
  conversation: { id: string; leadId: string | null },
  input: WaSendInput,
  template: string | null,
  body: string | null,
  result: { providerMessageId: string | null },
  providerKey: string,
  now: Date,
): Promise<WaSendOutcome> {
  // For a template send, `body` (the free-text field) is always null — the
  // real content lives in `renderedBody`, filled in by the composer from the
  // same template definition it showed as "This is what will be sent".
  const displayBody = template ? input.renderedBody?.trim() || null : body;

  const message = await prisma.waMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "out",
      type: template ? "template" : "text",
      body: displayBody,
      templateName: template,
      providerMessageId: result.providerMessageId,
      provider: providerKey,
      // Our verdict, not Meta's — see the module note.
      waStatus: "sent",
      sentById: input.sentById,
      occurredAt: now,
    },
    select: { id: true },
  });

  // `lastMessageAt` only. Sending must never extend the reply window — a
  // business that could reopen its own 24-hour window by messaging would make
  // the rule meaningless. `awaitingReply` clears here: someone has now answered.
  await prisma.waConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: now, status: "open", awaitingReply: false },
  });

  // Unlike inbound (deliberately silent, or a chatty thread would bury the
  // timeline), an outbound message is something a consultant DID — the same
  // reasoning that already puts WHATSAPP_SENT on the timeline from the
  // single-lead composer.
  if (conversation.leadId) {
    await recordLeadActivity({
      leadId: conversation.leadId,
      actorId: input.sentById,
      type: "WHATSAPP_SENT",
      summary: template ? `WhatsApp template sent: ${template}` : "WhatsApp message sent",
      metadata: { channel: "whatsapp", via: "inbox", template, providerMessageId: result.providerMessageId },
    });
  }

  return { ok: true, messageId: message.id, providerMessageId: result.providerMessageId };
}
