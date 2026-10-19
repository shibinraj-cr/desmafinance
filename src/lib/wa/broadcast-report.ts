/**
 * Broadcast Report — the pure half.
 *
 * A campaign's own report (the panel on /crm/broadcasts) answers "did it reach
 * people". This answers the question that comes after: who wrote back, did
 * anybody answer them, and what happened to the lead. The point is to get every
 * reply answered, so the centre of the page is the list of replies still waiting.
 *
 * Everything here is derived from what is already stored — the recipient rows
 * (delivery), the thread's messages (replies and our answers) and the lead's
 * timeline (stage moves, assignments, logged calls) — so it covers every
 * campaign ever sent, not just ones sent after this page existed.
 *
 * No prisma, no server imports: the page's client component runs the same
 * filtering and totals in the browser, so switching a campaign or an owner is
 * instant and the numbers on screen and in the .xlsx can never disagree. The
 * queries live in ./broadcast-report-data.
 *
 * The rules, in one place:
 *
 *   - A REPLY to a campaign is an inbound message on that number at or after
 *     the send, before the next campaign sent to the same number, with the first
 *     one arriving within the chosen number of days. The "next campaign" cut is
 *     what stops one reply counting for two campaigns.
 *   - ANSWERED means a person sent a WhatsApp message, or logged a call on the
 *     lead, after the candidate's LATEST message. Automated sends (assignment
 *     intro, drip, reminders) carry no author and never count. If the candidate
 *     writes again after we answered, the reply is waiting again.
 *   - A latest message that is an opt-out ("STOP") needs no answer; it is counted
 *     as OPTED OUT, not as waiting.
 *   - STAGE MOVED compares the stage before the first change after the reply with
 *     the stage after the last one. A lead moved and moved back did not move.
 *   - OWNER is the lead's current owner — the person who has to answer now.
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** WhatsApp only allows free text within 24 hours of the candidate's last message. */
export const SESSION_WINDOW_MS = DAY_MS;

/** Days after a send within which a first reply still counts for that campaign. */
export const REPLY_WINDOW_OPTIONS = [3, 7, 14] as const;
export const DEFAULT_REPLY_WINDOW_DAYS = 7;
/** The server attributes at the widest window; the page narrows from there. */
export const MAX_REPLY_WINDOW_DAYS = 14;

/** Filter key for "the lead has no owner". Never a real user id (cuid). */
export const NO_OWNER = "__none";

// ---------------------------------------------------------------------------
// Delivery

/** The furthest state a send reached. */
export type DeliveryOutcome = "pending" | "skipped" | "failed" | "accepted" | "delivered" | "read";

/**
 * One recipient's outcome — Meta's async state when it has given one, else our
 * send lifecycle. Same reading as the campaign export, so the two agree.
 */
export function deliveryOutcome(status: string, waStatus: string | null): DeliveryOutcome {
  if (waStatus === "read") return "read";
  if (waStatus === "delivered") return "delivered";
  if (waStatus === "failed" || status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  if (status === "sent") return "accepted";
  return "pending";
}

// ---------------------------------------------------------------------------
// Reply attribution

export type ThreadEvent =
  | { kind: "in"; at: number; text: string | null }
  /** A WhatsApp message a PERSON sent (WaMessage.sentById set). */
  | { kind: "out"; at: number; by: string }
  /** A call a person logged on the lead. */
  | { kind: "call"; at: number; by: string };

type ResponseEvent = Extract<ThreadEvent, { kind: "out" | "call" }>;
type InboundEvent = Extract<ThreadEvent, { kind: "in" }>;

export type ReplyState = "waiting" | "answered" | "opted_out";
export type ResponseVia = "whatsapp" | "call";

export type ReplyFacts = {
  firstReplyAt: number;
  lastInboundAt: number;
  firstText: string | null;
  lastText: string | null;
  inboundCount: number;
  state: ReplyState;
  /** First answer after the FIRST reply — the response-time measure. */
  firstResponseAt: number | null;
  firstResponseBy: string | null;
  firstResponseVia: ResponseVia | null;
  /** How the LATEST message was answered, when it was. */
  answeredVia: ResponseVia | null;
};

const byAt = (a: { at: number }, b: { at: number }) => a.at - b.at;
const viaOf = (e: ResponseEvent): ResponseVia => (e.kind === "call" ? "call" : "whatsapp");

/**
 * Did the candidate reply to THIS send, and has anyone answered them?
 * Null when there is no reply to attribute.
 */
export function attributeReply(input: {
  sentAt: number;
  /** When the next campaign reached this number — replies from then on belong to it. */
  nextSendAt: number | null;
  windowDays: number;
  events: ThreadEvent[];
  isOptOut: (text: string | null) => boolean;
}): ReplyFacts | null {
  const end = input.nextSendAt ?? Number.POSITIVE_INFINITY;
  const inbound = input.events
    .filter((e): e is InboundEvent => e.kind === "in" && e.at >= input.sentAt && e.at < end)
    .sort(byAt);
  if (inbound.length === 0) return null;

  const first = inbound[0];
  if (first.at - input.sentAt > input.windowDays * DAY_MS) return null;
  const last = inbound[inbound.length - 1];

  const responses = input.events.filter((e): e is ResponseEvent => e.kind !== "in").sort(byAt);
  const firstResponse = responses.find((r) => r.at > first.at) ?? null;
  const answer = responses.find((r) => r.at > last.at) ?? null;

  const state: ReplyState = answer ? "answered" : input.isOptOut(last.text) ? "opted_out" : "waiting";

  return {
    firstReplyAt: first.at,
    lastInboundAt: last.at,
    firstText: first.text,
    lastText: inbound.length > 1 ? last.text : null,
    inboundCount: inbound.length,
    state,
    firstResponseAt: firstResponse?.at ?? null,
    firstResponseBy: firstResponse?.by ?? null,
    firstResponseVia: firstResponse ? viaOf(firstResponse) : null,
    answeredVia: answer ? viaOf(answer) : null,
  };
}

// ---------------------------------------------------------------------------
// What happened to the lead after the reply

export type LeadEvent = {
  at: number;
  type: string;
  summary: string | null;
  metadata: unknown;
  actorId: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** "Status changed: Follow Up → Pipeline", which every writer of STATUS_CHANGED uses. */
const STATUS_SUMMARY = /^Status changed:\s*(.+?)\s*→\s*(.+?)\s*$/;

/**
 * The labels of one stage change. The summary first: some writers put only a
 * stage CODE in metadata (`{ to: "enrolled" }`), while the summary always
 * carries both labels.
 */
export function parseStatusChange(summary: string | null, metadata: unknown): { from: string | null; to: string | null } {
  const m = summary ? STATUS_SUMMARY.exec(summary) : null;
  if (m) return { from: m[1], to: m[2] };
  const md = asRecord(metadata);
  return { from: str(md?.from), to: str(md?.to) };
}

export type StageMove = {
  from: string;
  to: string;
  /** Every change in the move was made by the system, not a person. */
  auto: boolean;
};

/** The net stage change at or after `after`; null when the lead ended where it started. */
export function stageMoveAfter(events: LeadEvent[], after: number): StageMove | null {
  const changes = events.filter((e) => e.type === "STATUS_CHANGED" && e.at >= after).sort(byAt);
  if (changes.length === 0) return null;
  const first = parseStatusChange(changes[0].summary, changes[0].metadata);
  const last = parseStatusChange(changes[changes.length - 1].summary, changes[changes.length - 1].metadata);
  if (!last.to) return null;
  const from = first.from ?? "Earlier stage";
  if (from === last.to) return null;
  return { from, to: last.to, auto: changes.every((c) => !c.actorId) };
}

export type OwnerChange = { fromId: string | null; toId: string | null };

const OWNER_EVENT_TYPES = new Set(["ASSIGNED", "REASSIGNED", "UNASSIGNED"]);

/** The net owner change at or after `after` (assign, reassign or unassign). */
export function ownerChangeAfter(events: LeadEvent[], after: number): OwnerChange | null {
  const changes = events.filter((e) => OWNER_EVENT_TYPES.has(e.type) && e.at >= after).sort(byAt);
  if (changes.length === 0) return null;
  const lastEvent = changes[changes.length - 1];
  const fromId = str(asRecord(changes[0].metadata)?.fromUserId);
  const toId = lastEvent.type === "UNASSIGNED" ? null : str(asRecord(lastEvent.metadata)?.toUserId);
  // An assignment that does not say who it went to cannot be reported honestly.
  if (lastEvent.type !== "UNASSIGNED" && !toId) return null;
  if (fromId === toId) return null;
  return { fromId, toId };
}

// ---------------------------------------------------------------------------
// Wire format: what the server hands the page

export type ReportCampaign = {
  id: string;
  name: string;
  templateName: string;
  status: string;
  startedAt: number;
};

/** Recipients of one campaign, for one current owner, that reached one outcome. */
export type FunnelGroup = {
  campaignId: string;
  ownerId: string | null;
  outcome: DeliveryOutcome;
  n: number;
};

/** One recipient who replied. */
export type ReplyRow = ReplyFacts & {
  /** WaBroadcastRecipient id. */
  id: string;
  campaignId: string;
  leadId: string | null;
  conversationId: string;
  candidateName: string;
  phone: string;
  ownerId: string | null;
  stageNow: string | null;
  delivery: DeliveryOutcome;
  sentAt: number;
  move: StageMove | null;
  ownerChange: OwnerChange | null;
};

export type BroadcastReportData = {
  campaigns: ReportCampaign[];
  groups: FunnelGroup[];
  replies: ReplyRow[];
  /** userId → display name, for owners and responders. */
  people: Record<string, string>;
  generatedAt: number;
  /** A safety cap was hit; the totals may be short. */
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Filtering and totals

export type ReportFilter = {
  campaignIds: string[];
  /** User ids, or NO_OWNER. */
  ownerKeys: string[];
  windowDays: number;
};

export function ownerKeyOf(ownerId: string | null): string {
  return ownerId ?? NO_OWNER;
}

function kept(filter: Pick<ReportFilter, "campaignIds" | "ownerKeys">, campaignId: string, ownerId: string | null): boolean {
  if (filter.campaignIds.length && !filter.campaignIds.includes(campaignId)) return false;
  if (filter.ownerKeys.length && !filter.ownerKeys.includes(ownerKeyOf(ownerId))) return false;
  return true;
}

/** Narrow to the picked campaigns and owners. The reply window is applied by the totals. */
export function applyFilter(
  data: Pick<BroadcastReportData, "groups" | "replies">,
  filter: Pick<ReportFilter, "campaignIds" | "ownerKeys">,
): { groups: FunnelGroup[]; replies: ReplyRow[] } {
  return {
    groups: data.groups.filter((g) => kept(filter, g.campaignId, g.ownerId)),
    replies: data.replies.filter((r) => kept(filter, r.campaignId, r.ownerId)),
  };
}

/** Does this reply count under the chosen reply window? */
export function withinWindow(row: Pick<ReplyRow, "firstReplyAt" | "sentAt">, windowDays: number): boolean {
  return row.firstReplyAt - row.sentAt <= windowDays * DAY_MS;
}

export function sessionOpen(row: Pick<ReplyRow, "lastInboundAt">, now: number): boolean {
  return now - row.lastInboundAt < SESSION_WINDOW_MS;
}

export type ReportSummary = {
  /** Handed to WhatsApp: accepted, delivered, read or failed. */
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  /** Still queued — the campaign is mid-send. */
  pending: number;
  replied: number;
  answered: number;
  answeredByCall: number;
  optedOut: number;
  /** Answered or opted out: nothing left to do. */
  handled: number;
  waiting: number;
  waitingOpen: number;
  waitingClosed: number;
  waitingNoOwner: number;
  medianFirstResponseMs: number | null;
  oldestWaitingMs: number | null;
  stageMoved: number;
  ownerChanged: number;
  noAction: number;
};

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Totals for an already-filtered slice. */
export function summarise(groups: FunnelGroup[], replies: ReplyRow[], windowDays: number, now: number): ReportSummary {
  const by: Record<DeliveryOutcome, number> = { pending: 0, skipped: 0, failed: 0, accepted: 0, delivered: 0, read: 0 };
  for (const g of groups) by[g.outcome] += g.n;

  // A reply proves the message reached the phone and was seen, even when the
  // candidate has read receipts off and Meta never said so. Every attributed
  // reply counts here, whatever the window, so Read does not shift when the
  // window does.
  let upDelivered = 0;
  let upRead = 0;
  for (const r of replies) {
    if (r.delivery === "accepted") {
      upDelivered++;
      upRead++;
    } else if (r.delivery === "delivered") upRead++;
  }

  const s: ReportSummary = {
    sent: by.accepted + by.delivered + by.read + by.failed,
    delivered: by.delivered + by.read + upDelivered,
    read: by.read + upRead,
    failed: by.failed,
    skipped: by.skipped,
    pending: by.pending,
    replied: 0,
    answered: 0,
    answeredByCall: 0,
    optedOut: 0,
    handled: 0,
    waiting: 0,
    waitingOpen: 0,
    waitingClosed: 0,
    waitingNoOwner: 0,
    medianFirstResponseMs: null,
    oldestWaitingMs: null,
    stageMoved: 0,
    ownerChanged: 0,
    noAction: 0,
  };

  const responseTimes: number[] = [];
  for (const r of replies) {
    if (!withinWindow(r, windowDays)) continue;
    s.replied++;
    if (r.state === "answered") {
      s.answered++;
      if (r.answeredVia === "call") s.answeredByCall++;
    } else if (r.state === "opted_out") {
      s.optedOut++;
    } else {
      s.waiting++;
      if (sessionOpen(r, now)) s.waitingOpen++;
      else s.waitingClosed++;
      if (!r.ownerId) s.waitingNoOwner++;
      const waited = now - r.lastInboundAt;
      if (s.oldestWaitingMs === null || waited > s.oldestWaitingMs) s.oldestWaitingMs = waited;
    }
    if (r.firstResponseAt !== null) responseTimes.push(r.firstResponseAt - r.firstReplyAt);
    if (r.move) s.stageMoved++;
    if (r.ownerChange) s.ownerChanged++;
    if (!r.move && !r.ownerChange) s.noAction++;
  }
  s.handled = s.answered + s.optedOut;
  s.medianFirstResponseMs = median(responseTimes);
  return s;
}

export type SummaryRow = { key: string; summary: ReportSummary };

/** One summary per current owner — everyone with a send in the slice, plus anyone with a reply. */
export function summariseByOwner(groups: FunnelGroup[], replies: ReplyRow[], windowDays: number, now: number): SummaryRow[] {
  const keys = new Set<string>();
  for (const g of groups) keys.add(ownerKeyOf(g.ownerId));
  for (const r of replies) keys.add(ownerKeyOf(r.ownerId));
  return [...keys].map((key) => ({
    key,
    summary: summarise(
      groups.filter((g) => ownerKeyOf(g.ownerId) === key),
      replies.filter((r) => ownerKeyOf(r.ownerId) === key),
      windowDays,
      now,
    ),
  }));
}

export function summariseByCampaign(
  campaigns: ReportCampaign[],
  groups: FunnelGroup[],
  replies: ReplyRow[],
  windowDays: number,
  now: number,
): SummaryRow[] {
  return campaigns.map((c) => ({
    key: c.id,
    summary: summarise(
      groups.filter((g) => g.campaignId === c.id),
      replies.filter((r) => r.campaignId === c.id),
      windowDays,
      now,
    ),
  }));
}

export type StageMoveCount = { from: string; to: string; n: number; auto: number };

export function stageMoveCounts(replies: ReplyRow[]): StageMoveCount[] {
  const map = new Map<string, StageMoveCount>();
  for (const r of replies) {
    if (!r.move) continue;
    const key = `${r.move.from}→${r.move.to}`;
    const row = map.get(key) ?? { from: r.move.from, to: r.move.to, n: 0, auto: 0 };
    row.n++;
    if (r.move.auto) row.auto++;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.n - a.n || a.from.localeCompare(b.from));
}

export type OwnerChangeCount = { fromId: string | null; toId: string | null; n: number };

export function ownerChangeCounts(replies: ReplyRow[]): OwnerChangeCount[] {
  const map = new Map<string, OwnerChangeCount>();
  for (const r of replies) {
    if (!r.ownerChange) continue;
    const key = `${ownerKeyOf(r.ownerChange.fromId)}→${ownerKeyOf(r.ownerChange.toId)}`;
    const row = map.get(key) ?? { fromId: r.ownerChange.fromId, toId: r.ownerChange.toId, n: 0 };
    row.n++;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.n - a.n);
}

// ---------------------------------------------------------------------------
// The worklist

export const WORKLIST_TABS = ["waiting", "no_owner", "handled", "all"] as const;
export type WorklistTab = (typeof WORKLIST_TABS)[number];

/** A drill-down from the outcome panels into the worklist. */
export type WorklistFocus =
  | { kind: "move"; from: string; to: string }
  | { kind: "owner_change"; fromId: string | null; toId: string | null }
  | { kind: "no_action" };

export function matchesFocus(r: ReplyRow, focus: WorklistFocus | null): boolean {
  if (!focus) return true;
  if (focus.kind === "move") return !!r.move && r.move.from === focus.from && r.move.to === focus.to;
  if (focus.kind === "owner_change") {
    return !!r.ownerChange && r.ownerChange.fromId === focus.fromId && r.ownerChange.toId === focus.toId;
  }
  return !r.move && !r.ownerChange;
}

function inTab(r: ReplyRow, tab: WorklistTab): boolean {
  if (tab === "waiting") return r.state === "waiting";
  if (tab === "no_owner") return !r.ownerId;
  if (tab === "handled") return r.state !== "waiting";
  return true;
}

export function worklistCounts(rows: ReplyRow[]): Record<WorklistTab, number> {
  const out: Record<WorklistTab, number> = { waiting: 0, no_owner: 0, handled: 0, all: 0 };
  for (const r of rows) for (const t of WORKLIST_TABS) if (inTab(r, t)) out[t]++;
  return out;
}

/**
 * The rows for one tab. Waiting replies come longest-waiting first — the one
 * that has waited longest is the one to answer next. Everything else is newest
 * first.
 */
export function worklist(rows: ReplyRow[], tab: WorklistTab): ReplyRow[] {
  const list = rows.filter((r) => inTab(r, tab));
  return list.sort((a, b) => {
    const aw = a.state === "waiting" ? 0 : 1;
    const bw = b.state === "waiting" ? 0 : 1;
    if (aw !== bw) return aw - bw;
    return aw === 0 ? a.lastInboundAt - b.lastInboundAt : b.lastInboundAt - a.lastInboundAt;
  });
}

// ---------------------------------------------------------------------------
// Date range (which campaigns are on the page — by when they started sending)

export const RANGE_OPTIONS = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "Custom range" },
] as const;
export type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];
export const DEFAULT_RANGE: RangeKey = "30d";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD in IST. */
export function istDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function istMidnight(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

export type ResolvedRange = { key: RangeKey; from: Date; to: Date | null; fromDay: string | null; toDay: string | null };

/**
 * The send-start window for a range choice. Custom days are IST and inclusive.
 * Anything unreadable falls back to the default rather than to "everything",
 * which on a busy account would be the slowest possible page.
 */
export function resolveRange(key: string | undefined, fromDay: string | undefined, toDay: string | undefined, now: Date): ResolvedRange {
  const today = istDay(now);
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  switch (key) {
    case "7d":
      return { key, from: new Date(now.getTime() - 7 * DAY_MS), to: null, fromDay: null, toDay: null };
    case "90d":
      return { key, from: new Date(now.getTime() - 90 * DAY_MS), to: null, fromDay: null, toDay: null };
    case "month":
      return { key, from: istMidnight(monthStart), to: null, fromDay: null, toDay: null };
    case "last_month":
      return { key, from: istMidnight(prev), to: istMidnight(monthStart), fromDay: null, toDay: null };
    case "custom":
      if (fromDay && toDay && DAY_RE.test(fromDay) && DAY_RE.test(toDay) && fromDay <= toDay) {
        const to = new Date(istMidnight(toDay).getTime() + DAY_MS);
        if (!Number.isNaN(to.getTime())) return { key, from: istMidnight(fromDay), to, fromDay, toDay };
      }
      break;
  }
  return { key: "30d", from: new Date(now.getTime() - 30 * DAY_MS), to: null, fromDay: null, toDay: null };
}

// ---------------------------------------------------------------------------
// Display helpers shared by the page and the export

/** "45m", "3h 20m", "2d 4h". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const mins = Math.max(1, Math.round(ms / 60_000));
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
