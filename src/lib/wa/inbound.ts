/**
 * Parsing inbound WhatsApp webhooks into one normalised event shape.
 *
 * This is pure and has no database access, because it is the part most likely to
 * be wrong and the only part we can test without a live number. Everything that
 * touches Prisma lives in ./mirror.
 *
 * Three envelope styles have to work, and the first one is why this file is
 * cheap insurance:
 *
 *   - Meta's NATIVE webhook, `entry[].changes[].value.messages[]`, batched. This
 *     is what the Cloud API sends us after cutover — and also what Wabis relays
 *     today through its global hooks, which is why the existing delivery-status
 *     parser (extractDeliveryEvents, crm-remarketing.ts) is already written
 *     against this exact shape. Pointing Meta straight at us changes the auth,
 *     not the parsing.
 *   - A flat `{ phone, message, ... }` body, which is what a per-workflow Wabis
 *     HTTP API block sends.
 *   - A bare test curl with query params.
 *
 * Field names are read leniently for the same reason the re-marketing inbound
 * hook reads them leniently: a BSP's field naming is configuration, not contract.
 */

/** One inbound message, normalised out of whatever envelope carried it. */
export type WaInboundMessage = {
  /** Sender's number as the provider gave it — normalised downstream. */
  from: string | null;
  /** Provider message id (`wamid.…`). The idempotency key; null means we cannot dedupe. */
  providerMessageId: string | null;
  type: WaMessageType;
  /** Text body or media caption. */
  body: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  fileName: string | null;
  /** Provider timestamp, or null when it sent none (caller stamps `now`). */
  occurredAt: Date | null;
  /** Echoed from our own outbound payload, when the flow passes it back. */
  leadId: string | null;
};

export const WA_MESSAGE_TYPES = [
  "text",
  "image",
  "document",
  "audio",
  "video",
  "sticker",
  "location",
  "contacts",
  "interactive",
  "button",
  "template",
  "unsupported",
] as const;

export type WaMessageType = (typeof WA_MESSAGE_TYPES)[number];

const KNOWN_TYPES = new Set<string>(WA_MESSAGE_TYPES);

/**
 * Words that mean "stop messaging me".
 *
 * Deliberately matched as the WHOLE message, trimmed, not as a substring: "stop
 * sending me the wrong course details" is a complaint to answer, not an opt-out,
 * and treating it as one would silently drop a live candidate out of every
 * future campaign. WhatsApp itself surfaces these as one-tap replies, so the
 * exact-match case is the one that actually occurs.
 */
const OPT_OUT_WORDS: ReadonlySet<string> = new Set([
  "stop",
  "unsubscribe",
  "opt out",
  "optout",
  "remove me",
  "do not message",
  "dont message",
  "don't message",
]);

/** Is this message the candidate asking to be left alone? */
export function isOptOutMessage(text: string | null | undefined): boolean {
  const t = (text ?? "").trim().toLowerCase().replace(/[.!]+$/, "");
  if (!t) return false;
  return OPT_OUT_WORDS.has(t);
}

/** Read a string-ish field under any of several names. */
function pick(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * WhatsApp sends epoch SECONDS as a string; our own flat shapes send ISO. Both
 * are accepted, and anything implausible is discarded rather than guessed — a
 * message stamped 1970 would sort to the top of the thread forever.
 */
export function parseWaTimestamp(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;

  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d{9,11}$/.test(s)) return plausible(new Date(Number(s) * 1000));
  // Milliseconds, in case a relay normalises for us.
  if (/^\d{12,14}$/.test(s)) return plausible(new Date(Number(s)));

  return plausible(new Date(s));
}

/**
 * WhatsApp launched in 2009 and a message cannot be from the future, so anything
 * outside those bounds is a misparse rather than a timestamp — a 9-digit epoch
 * (the 1970s-90s) or an 11-digit one (the year 2500) both satisfy the digit
 * patterns above while being obvious nonsense. Rejecting rather than guessing
 * matters because `occurredAt` drives thread ordering AND the 24-hour reply
 * window: one bad value either pins a message to the top of the thread forever
 * or holds a closed session open.
 */
function plausible(d: Date): Date | null {
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() < 2009) return null;
  // A day's grace absorbs ordinary clock skew between us and the provider.
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return d;
}

export function normalizeMessageType(raw: unknown): WaMessageType {
  const t = String(raw ?? "").trim().toLowerCase();
  if (!t) return "text";
  return KNOWN_TYPES.has(t) ? (t as WaMessageType) : "unsupported";
}

/**
 * Pull the text out of a message object, wherever this envelope keeps it.
 *
 * Meta nests it by type (`text.body`, `image.caption`, and for a tapped button
 * `interactive.button_reply.title`), while flat relays put it at the top level.
 * A button reply IS the candidate's answer — dropping it would silently discard
 * exactly the "Interested" taps the re-marketing keyword gate depends on.
 */
export function extractBody(msg: Record<string, unknown>, type: WaMessageType): string | null {
  const nested = asObject(msg[type]);
  if (nested) {
    const v = pick(nested, "body", "caption", "text");
    if (v) return v;
  }

  const interactive = asObject(msg.interactive);
  if (interactive) {
    for (const k of ["button_reply", "list_reply", "nfm_reply"]) {
      const reply = asObject(interactive[k]);
      const v = reply && pick(reply, "title", "description", "id");
      if (v) return v;
    }
  }

  const button = asObject(msg.button);
  if (button) {
    const v = pick(button, "text", "payload");
    if (v) return v;
  }

  return pick(msg, "body", "text", "message", "caption", "reply", "keyword");
}

function readMessage(raw: Record<string, unknown>): WaInboundMessage {
  const type = normalizeMessageType(raw.type ?? raw.message_type ?? raw.messageType);
  const media = asObject(raw[type]);

  return {
    from: pick(raw, "from", "phone", "mobile", "wa_id", "waId", "sender", "subscriber", "msisdn"),
    providerMessageId: pick(raw, "id", "message_id", "messageId", "wamid"),
    type,
    body: extractBody(raw, type),
    mediaId: (media && pick(media, "id", "media_id")) ?? pick(raw, "media_id", "mediaId"),
    mediaMime: (media && pick(media, "mime_type", "mimeType")) ?? pick(raw, "mime_type", "mimeType"),
    fileName: (media && pick(media, "filename", "file_name")) ?? pick(raw, "filename", "file_name"),
    occurredAt: parseWaTimestamp(raw.timestamp ?? raw.occurredAt ?? raw.created_at ?? raw.time),
    leadId: pick(raw, "lead_id", "leadId"),
  };
}

/**
 * Extract every inbound message from a webhook body.
 *
 * Statuses are deliberately NOT handled here — they already have a home in
 * handleWabisDeliveryStatus, and a body carrying only statuses correctly yields
 * an empty array so the caller can hand it to the existing path instead.
 *
 * A message with no sender is dropped: without a number there is no thread to
 * attach it to, and inventing one would corrupt the mirror.
 */
export function extractInboundMessages(body: unknown): WaInboundMessage[] {
  const b = asObject(body);
  if (!b) return [];

  const raw: Record<string, unknown>[] = [];

  // Native Meta envelope, batched: entry[].changes[].value.messages[]
  const entries = Array.isArray(b.entry) ? (b.entry as unknown[]) : [];
  for (const e of entries) {
    const entry = asObject(e);
    const changes = entry && Array.isArray(entry.changes) ? (entry.changes as unknown[]) : [];
    for (const c of changes) {
      const change = asObject(c);
      const value = change && asObject(change.value);
      const messages = value && Array.isArray(value.messages) ? (value.messages as unknown[]) : [];
      for (const m of messages) {
        const msg = asObject(m);
        if (msg) raw.push(msg);
      }
    }
  }

  // Top-level arrays some relays use. `statuses` is excluded on purpose.
  if (raw.length === 0) {
    for (const key of ["messages", "data"]) {
      const v = b[key];
      if (Array.isArray(v)) {
        for (const it of v) {
          const o = asObject(it);
          if (o) raw.push(o);
        }
      } else {
        const o = key === "data" ? asObject(v) : null;
        if (o) raw.push(o);
      }
    }
  }

  // A flat body IS the message — but only when it is not a status callback
  // wearing a different hat, which the statuses key gives away.
  if (raw.length === 0 && !("statuses" in b)) raw.push(b);

  return raw.filter((r) => !isStatusCallback(r)).map(readMessage).filter((m) => !!m.from);
}

/**
 * Is this object a DELIVERY STATUS rather than a message?
 *
 * The top-level `statuses` key only catches Meta's own shape. The sibling parser
 * (extractDeliveryEvents in crm-remarketing.ts) proves three more are in use — a
 * flat `{phone, status, …}`, a `{data:{…}}` wrapper, and a top-level `messages[]`
 * of statuses — and all three slip past a key check. Left unfiltered they are
 * read as inbound messages and mirrored into the thread as empty bubbles, which
 * is worse than dropping them: the delivery-status hook already owns this data.
 *
 * The discriminator is a status verb with no message content. Requiring BOTH
 * keeps a genuine message whose text happens to be the word "read" from being
 * mistaken for a status.
 */
const STATUS_VERBS = new Set(["sent", "delivered", "read", "failed", "deleted", "warning"]);

function isStatusCallback(o: Record<string, unknown>): boolean {
  const status = pick(o, "status", "message_status", "messageStatus", "delivery_status");
  if (!status || !STATUS_VERBS.has(status.toLowerCase())) return false;
  // A real message always carries a type or a body; a status carries neither.
  const hasContent = !!extractBody(o, normalizeMessageType(o.type)) || !!asObject(o.text) || !!asObject(o.image);
  return !hasContent;
}
