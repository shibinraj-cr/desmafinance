/**
 * Reading Meta's Instagram messaging webhook.
 *
 * Pure: turns the envelope into a flat list of events the ingest understands,
 * and nothing else. Shape (object "instagram", via the Page the account is
 * linked to):
 *
 *   { object: "instagram",
 *     entry: [{ id: <our IG account id>, time,
 *               messaging: [{ sender: {id}, recipient: {id}, timestamp,
 *                             message: { mid, text, is_echo?, quick_reply?: {payload},
 *                                        attachments?: [{type}], is_deleted?, is_unsupported? }
 *                           | postback: { mid, title, payload } }],
 *               standby?: [ …same shape… ] }] }
 *
 * Three things are load-bearing:
 *
 *   - **Echoes.** Every message the BUSINESS sends — our auto-ask, or a person
 *     replying in Business Suite — comes back on the same `messages` field with
 *     `is_echo: true`, sender = us and recipient = the candidate. They are kept
 *     (they are how we learn a human has taken over) but keyed on the
 *     candidate, never mistaken for one.
 *   - **Standby.** When another app owns the conversation (Business Suite's own
 *     automations, a chatbot tool), our app receives the thread on `standby`
 *     instead. Those messages are still captured — they are still leads — but
 *     flagged so auto-ask never talks over the app that owns the thread.
 *   - **Not every event is a message.** Reads, reactions, deletions and edits
 *     ride the same envelope and are dropped here.
 */

export type IgEvent = {
  /** "in" = the candidate wrote; "echo" = the business wrote (us or a person). */
  kind: "in" | "echo";
  /** The candidate's Instagram-scoped id, whichever side of the message they were on. */
  igsid: string;
  /** Our Instagram account id, as Meta put it on the entry. */
  accountId: string | null;
  mid: string | null;
  text: string | null;
  quickReplyPayload: string | null;
  attachmentType: string | null;
  occurredAt: Date | null;
  /** Arrived on `standby`: another app owns this conversation. */
  standby: boolean;
};

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function asStr(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? v : null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Meta's `timestamp` is epoch MILLISECONDS on messaging events. Seconds are
 * accepted too, and anything implausible (before Instagram DMs existed, or
 * more than a day in the future) is treated as unknown rather than sorting a
 * message to the far end of a thread forever.
 */
export function parseIgTimestamp(v: unknown, now: Date = new Date()): Date | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  if (d.getUTCFullYear() < 2015) return null;
  if (ms > now.getTime() + 24 * 60 * 60 * 1000) return null;
  return d;
}

function eventFrom(raw: unknown, entryAccountId: string | null, standby: boolean): IgEvent | null {
  const ev = asObj(raw);
  if (!ev) return null;
  const senderId = asStr(asObj(ev.sender)?.id);
  const recipientId = asStr(asObj(ev.recipient)?.id);
  const occurredAt = parseIgTimestamp(ev.timestamp);

  const message = asObj(ev.message);
  const postback = asObj(ev.postback);

  if (message) {
    // A deletion or an edit notice is not something the candidate said.
    if (message.is_deleted === true) return null;

    // An echo, or anything sent BY our own account (some echoes omit the flag
    // when the business messages from another client).
    const isEcho = message.is_echo === true || (!!entryAccountId && senderId === entryAccountId);
    const igsid = isEcho ? recipientId : senderId;
    if (!igsid) return null;

    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const firstType = asStr(asObj(attachments[0])?.type);
    return {
      kind: isEcho ? "echo" : "in",
      igsid,
      accountId: entryAccountId ?? (isEcho ? senderId : recipientId),
      mid: asStr(message.mid),
      text: asStr(message.text),
      quickReplyPayload: asStr(asObj(message.quick_reply)?.payload),
      attachmentType: message.is_unsupported === true ? "unsupported" : firstType,
      occurredAt,
      standby,
    };
  }

  // A tapped ice-breaker or button: the candidate "said" its title.
  if (postback) {
    if (!senderId || (entryAccountId && senderId === entryAccountId)) return null;
    return {
      kind: "in",
      igsid: senderId,
      accountId: entryAccountId ?? recipientId,
      mid: asStr(postback.mid),
      text: asStr(postback.title),
      quickReplyPayload: asStr(postback.payload),
      attachmentType: null,
      occurredAt,
      standby,
    };
  }

  return null;
}

/** Every message event in one delivery, oldest first. Unknown shapes yield nothing. */
export function extractIgEvents(body: unknown): IgEvent[] {
  const root = asObj(body);
  if (!root || root.object !== "instagram" || !Array.isArray(root.entry)) return [];

  const out: IgEvent[] = [];
  for (const e of root.entry) {
    const entry = asObj(e);
    if (!entry) continue;
    const accountId = asStr(entry.id);
    for (const raw of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const ev = eventFrom(raw, accountId, false);
      if (ev) out.push(ev);
    }
    for (const raw of Array.isArray(entry.standby) ? entry.standby : []) {
      const ev = eventFrom(raw, accountId, true);
      if (ev) out.push(ev);
    }
  }
  // Meta batches; a batch is not guaranteed to be in order, and the ingest's
  // "first message" logic depends on reading a conversation as it happened.
  return out.sort((a, b) => (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0));
}
