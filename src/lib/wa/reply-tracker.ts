/**
 * WhatsApp Reply Tracker — the pure half. The queries live in
 * ./reply-tracker-data; the page is /crm/wa-replies.
 *
 * The question this page answers is "has every message on the company WhatsApp
 * been answered, and how fast?". It reads the same rule the inbox's
 * **Needs reply** filter reads (see `awaitingReply` in prisma/schema.prisma and
 * recordSentMessage in ./send): a candidate's message is answered only when a
 * PERSON sends a WhatsApp message after it. Automated sends — the assignment
 * intro, re-marketing touches, task reminders — carry no `sentById` and do not
 * count, because a reminder is not an answer to what the candidate wrote.
 *
 * The unit is an EXCHANGE, not a message. A candidate who types "hi", "I am a
 * nurse", "what is the fee?" in a row has asked one thing; counting three
 * unanswered messages would triple-count a single wait. An exchange starts at
 * the first inbound message after the last human reply and ends at the next
 * human reply.
 *
 * An exchange nobody answered but that an AUTOMATED message followed is "bot
 * replied" (see ./reply-state): not an answer, but the candidate now has
 * something from us to respond to, so it sits on its own list rather than in
 * "waiting".
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
/** WhatsApp's customer-service window: free text only within 24h of the candidate's last message. */
export const SESSION_WINDOW_MS = DAY_MS;
const IST_OFFSET_MS = 5.5 * HOUR_MS;

/** First-response targets the page can be judged against, in minutes. */
export const SLA_OPTIONS = [15, 30, 60, 240] as const;
export const DEFAULT_SLA_MINUTES = 60;

/** Owner key for a thread nobody owns — never collides with a cuid. */
export const NO_OWNER = "__none";
export function ownerKeyOf(ownerId: string | null): string {
  return ownerId ?? NO_OWNER;
}

// ---------------------------------------------------------------------------
// Pairing messages into exchanges

export type TrackerMessage = {
  direction: string;
  occurredAt: number;
  /** The CRM user who sent an outbound message; null on inbound and on automated sends. */
  sentById: string | null;
};

export type Exchange = {
  /** The candidate's first message of the exchange — the wait starts here. */
  askedAt: number;
  /** Their latest message of the exchange. */
  lastInboundAt: number;
  inboundCount: number;
  /** The first human reply after it, or null while nobody has answered. */
  answeredAt: number | null;
  answeredById: string | null;
  /** First automated message after their latest one, while nobody has answered. */
  autoAt: number | null;
};

/** Is this an outbound message a person sent (i.e. an answer)? */
function isHumanReply(m: TrackerMessage): boolean {
  return m.direction === "out" && !!m.sentById;
}

/**
 * Split one thread's messages (any order) into exchanges, oldest first.
 *
 * Inbound messages in a row join one exchange; a human reply closes it.
 * Automated outbound messages never answer or start anything; they only mark
 * an open exchange as bot-replied (`autoAt`) until the candidate writes again.
 */
export function pairExchanges(messages: TrackerMessage[]): Exchange[] {
  const sorted = [...messages].sort((a, b) => a.occurredAt - b.occurredAt);
  const out: Exchange[] = [];
  let open: Exchange | null = null;
  for (const m of sorted) {
    if (m.direction === "in") {
      if (open) {
        open.lastInboundAt = m.occurredAt;
        open.inboundCount += 1;
        // They wrote again after the bot: their turn is over, ours again.
        open.autoAt = null;
      } else {
        open = { askedAt: m.occurredAt, lastInboundAt: m.occurredAt, inboundCount: 1, answeredAt: null, answeredById: null, autoAt: null };
      }
    } else if (isHumanReply(m) && open) {
      open.answeredAt = m.occurredAt;
      open.answeredById = m.sentById;
      open.autoAt = null;
      out.push(open);
      open = null;
    } else if (m.direction === "out" && open && open.autoAt === null) {
      open.autoAt = m.occurredAt;
    }
  }
  if (open) out.push(open);
  return out;
}

/**
 * When the CURRENT wait on a thread began: the first inbound message after the
 * last human reply. Null when the newest exchange has been answered (or there
 * is nothing inbound at all).
 */
export function waitingSince(messages: TrackerMessage[]): { since: number; inboundCount: number; autoAt: number | null } | null {
  const ex = pairExchanges(messages);
  const last = ex[ex.length - 1];
  if (!last || last.answeredAt !== null) return null;
  return { since: last.askedAt, inboundCount: last.inboundCount, autoAt: last.autoAt };
}

// ---------------------------------------------------------------------------
// Rows the page works with

/** A thread waiting on a reply right now. */
export type WaitingRow = {
  conversationId: string;
  phoneE164: string;
  leadId: string | null;
  candidateName: string | null;
  stage: string | null;
  ownerId: string | null;
  /** When the wait started (first unanswered message). */
  since: number;
  /** The candidate's latest message — the 24h window runs from here. */
  lastInboundAt: number;
  /** How many messages they have sent since the last reply. */
  inboundCount: number;
  preview: string | null;
  sourceCampaign: string | null;
};

/** A thread nobody answered, where only an automated message followed theirs. */
export type BotRow = WaitingRow & {
  /** When the bot message went out. */
  autoAt: number;
  /** Which automated message it was (template name), when known. */
  autoTemplate: string | null;
};

export type ExchangeState = "answered" | "waiting" | "auto" | "closed";

/** One exchange that STARTED inside the chosen period. */
export type ExchangeRow = {
  conversationId: string;
  ownerId: string | null;
  askedAt: number;
  answeredAt: number | null;
  answeredById: string | null;
  inboundCount: number;
  /**
   * "closed": nobody replied, and someone closed the thread instead.
   * "auto": nobody replied, but an automated message followed theirs.
   */
  state: ExchangeState;
};

export type ThreadInfo = { phoneE164: string; leadId: string | null; candidateName: string | null; stage: string | null };

export type ReplyTrackerData = {
  generatedAt: number;
  range: { key: TrackerRangeKey; from: number; to: number };
  waiting: WaitingRow[];
  /** "Bot replied" — see BotRow. */
  botReplied: BotRow[];
  exchanges: ExchangeRow[];
  /** Names/phones for the threads `exchanges` mention, keyed by conversation id. */
  threads: Record<string, ThreadInfo>;
  /** userId → display name, for owners and repliers. */
  people: Record<string, string>;
  /** A query hit its row cap, so some totals may be short. */
  truncated: boolean;
};

export function exchangeState(ex: Exchange, conversationStatus: string): ExchangeState {
  if (ex.answeredAt !== null) return "answered";
  if (conversationStatus === "closed") return "closed";
  return ex.autoAt !== null ? "auto" : "waiting";
}

// ---------------------------------------------------------------------------
// Waiting-now buckets

export const AGE_BUCKETS = [
  { key: "lt15m", label: "Under 15 min", maxMs: 15 * MINUTE_MS, tone: "green" },
  { key: "lt1h", label: "15 min – 1 h", maxMs: HOUR_MS, tone: "amber" },
  { key: "lt4h", label: "1 – 4 h", maxMs: 4 * HOUR_MS, tone: "amber" },
  { key: "lt24h", label: "4 – 24 h", maxMs: SESSION_WINDOW_MS, tone: "red" },
  { key: "over24h", label: "Over 24 h", maxMs: Infinity, tone: "red" },
] as const;
export type AgeBucketKey = (typeof AGE_BUCKETS)[number]["key"];

export function ageBucket(ageMs: number): AgeBucketKey {
  for (const b of AGE_BUCKETS) if (ageMs < b.maxMs) return b.key;
  return "over24h";
}

export function bucketCounts(rows: WaitingRow[], now: number): Record<AgeBucketKey, number> {
  const counts = Object.fromEntries(AGE_BUCKETS.map((b) => [b.key, 0])) as Record<AgeBucketKey, number>;
  for (const r of rows) counts[ageBucket(now - r.since)] += 1;
  return counts;
}

/** Can a free-text reply still go out, or only a template? */
export function windowOpen(row: Pick<WaitingRow, "lastInboundAt">, now: number): boolean {
  return now - row.lastInboundAt < SESSION_WINDOW_MS;
}

/** Longest wait first — the worklist's order. */
export function sortWaiting<T extends WaitingRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.since - b.since || a.conversationId.localeCompare(b.conversationId));
}

// ---------------------------------------------------------------------------
// Period summary

export type TrackerSummary = {
  /** Exchanges that started in the period. */
  received: number;
  answered: number;
  /** Answered within the SLA. */
  onTime: number;
  /** Answered, but after the SLA. */
  late: number;
  /** Still waiting, already past the SLA. */
  overdue: number;
  /** Still waiting, but younger than the SLA — not judged yet. */
  pending: number;
  /** Closed without a reply. */
  closed: number;
  /** Nobody answered, but a bot message followed theirs. Not judged against the SLA. */
  auto: number;
  /** onTime / (answered + overdue) — the share of judged exchanges that met the SLA. */
  slaBase: number;
  medianMs: number | null;
  p90Ms: number | null;
};

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[idx];
}

export function summarise(rows: ExchangeRow[], slaMs: number, now: number): TrackerSummary {
  let answered = 0;
  let onTime = 0;
  let overdue = 0;
  let pending = 0;
  let closed = 0;
  let auto = 0;
  const times: number[] = [];
  for (const r of rows) {
    if (r.state === "answered" && r.answeredAt !== null) {
      answered += 1;
      const t = r.answeredAt - r.askedAt;
      times.push(t);
      if (t <= slaMs) onTime += 1;
    } else if (r.state === "closed") {
      closed += 1;
    } else if (r.state === "auto") {
      auto += 1;
    } else if (now - r.askedAt > slaMs) {
      overdue += 1;
    } else {
      pending += 1;
    }
  }
  return {
    received: rows.length,
    answered,
    onTime,
    late: answered - onTime,
    overdue,
    pending,
    closed,
    auto,
    slaBase: answered + overdue,
    medianMs: quantile(times, 0.5),
    p90Ms: quantile(times, 0.9),
  };
}

export type OwnerRow = {
  key: string;
  waitingNow: number;
  /** Age of the longest current wait, ms. */
  oldestMs: number | null;
  windowClosed: number;
  /** Threads on the "Bot replied" list now. */
  botReplied: number;
  summary: TrackerSummary;
};

/** One row per owner who has anything waiting now or anything in the period. Worst first. */
export function summariseByOwner(
  waiting: WaitingRow[],
  exchanges: ExchangeRow[],
  slaMs: number,
  now: number,
  botReplied: WaitingRow[] = [],
): OwnerRow[] {
  const keys = new Set<string>();
  for (const w of waiting) keys.add(ownerKeyOf(w.ownerId));
  for (const b of botReplied) keys.add(ownerKeyOf(b.ownerId));
  for (const e of exchanges) keys.add(ownerKeyOf(e.ownerId));
  const rows: OwnerRow[] = [];
  for (const key of keys) {
    const mine = waiting.filter((w) => ownerKeyOf(w.ownerId) === key);
    const oldest = mine.reduce<number | null>((m, w) => (m === null || w.since < m ? w.since : m), null);
    rows.push({
      key,
      waitingNow: mine.length,
      oldestMs: oldest === null ? null : now - oldest,
      windowClosed: mine.filter((w) => !windowOpen(w, now)).length,
      botReplied: botReplied.filter((b) => ownerKeyOf(b.ownerId) === key).length,
      summary: summarise(
        exchanges.filter((e) => ownerKeyOf(e.ownerId) === key),
        slaMs,
        now,
      ),
    });
  }
  return rows.sort(
    (a, b) =>
      b.waitingNow - a.waitingNow ||
      (b.oldestMs ?? -1) - (a.oldestMs ?? -1) ||
      b.summary.overdue - a.summary.overdue ||
      b.summary.received - a.summary.received ||
      a.key.localeCompare(b.key),
  );
}

/** Answered after the SLA, slowest first — the "where did we slip" list. */
export function lateAnswers(rows: ExchangeRow[], slaMs: number): ExchangeRow[] {
  return rows
    .filter((r) => r.state === "answered" && r.answeredAt !== null && r.answeredAt - r.askedAt > slaMs)
    .sort((a, b) => b.answeredAt! - b.askedAt - (a.answeredAt! - a.askedAt));
}

// ---------------------------------------------------------------------------
// Period (IST calendar days)

export const TRACKER_RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
] as const;
export type TrackerRangeKey = (typeof TRACKER_RANGES)[number]["key"];
export const DEFAULT_TRACKER_RANGE: TrackerRangeKey = "today";

/** Midnight IST of the day `now` falls on, as a UTC instant. */
export function istDayStart(now: number): number {
  return Math.floor((now + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

export function resolveTrackerRange(key: string | null | undefined, now: number): { key: TrackerRangeKey; from: number; to: number } {
  const today = istDayStart(now);
  switch (key) {
    case "yesterday":
      return { key, from: today - DAY_MS, to: today };
    case "7d":
      return { key, from: today - 6 * DAY_MS, to: now };
    case "30d":
      return { key, from: today - 29 * DAY_MS, to: now };
    default:
      return { key: "today", from: today, to: now };
  }
}

// ---------------------------------------------------------------------------
// Display helpers

/** "45m", "3h 20m", "2d 4h". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const mins = Math.max(1, Math.round(ms / MINUTE_MS));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function percent(n: number, d: number): string {
  if (!d) return "—";
  const p = (n / d) * 100;
  return `${p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

export function slaLabel(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}
