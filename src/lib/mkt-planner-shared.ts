/**
 * Marketing & Branding Planner — vocabulary and pure maths shared by server and
 * client code. No imports, so the planner's client components can use it
 * without pulling server-only modules into the browser bundle. Server helpers
 * (access check, Prisma loaders) live in ./mkt-planner.
 *
 * Money is whole rupees (Int) everywhere. Dates are IST calendar days as
 * "YYYY-MM-DD" strings. A fiscal year is named by its opening calendar year
 * (2026 = FY 2026-27, April to March) and months are indexed from April
 * (0 = Apr … 11 = Mar), matching ./fiscal-year.
 */

export const MKT_PLANNER_HREF = "/marketing/planner";

/** Expense category whose ledger rows are marketing spend. */
export const MARKETING_CATEGORY = "Marketing";

export const CAMPAIGN_TYPES = ["performance", "brand", "event", "content", "partnerships"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  performance: "Performance",
  brand: "Brand",
  event: "Event",
  content: "Content",
  partnerships: "Partnerships",
};

export const CAMPAIGN_STATUSES = ["idea", "draft", "awaiting", "approved", "done", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
/** What the UI shows: stored status, except an approved campaign inside its dates is "live". */
export type DisplayStatus = CampaignStatus | "live";
export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  idea: "Idea",
  draft: "Draft",
  awaiting: "Awaiting approval",
  approved: "Approved",
  live: "Live",
  done: "Done",
  cancelled: "Cancelled",
};

export const COMMITMENT_KINDS = ["quote", "booking", "po", "advance"] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];
export const COMMITMENT_KIND_LABELS: Record<CommitmentKind, string> = {
  quote: "Quote accepted",
  booking: "Booking",
  po: "PO raised",
  advance: "Advance due",
};

export const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"] as const;

/** Chart series colours (validated for CVD separation on the Darkroom surface). */
export const SERIES_SPENT = "#b08608";
export const SERIES_COMMITTED = "#2a8fc4";

// ── Dates ──────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function dayMs(ds: string): number {
  const [y, m, d] = ds.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function dayStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Days from a to b (b − a), both "YYYY-MM-DD". */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
}

export function addDaysStr(ds: string, days: number): string {
  return dayStr(dayMs(ds) + days * DAY_MS);
}

/** Fiscal year a day belongs to (Jan–Mar belong to the previous April's year). */
export function fyOfDay(ds: string): number {
  const y = Number(ds.slice(0, 4));
  const m = Number(ds.slice(5, 7));
  return m >= 4 ? y : y - 1;
}

/** Fiscal month index of a day: 0 = April … 11 = March. */
export function fyMonthOfDay(ds: string): number {
  return (Number(ds.slice(5, 7)) + 8) % 12;
}

/** First day of fiscal month `idx` of `fy`. */
export function fyMonthFirstDay(fy: number, idx: number): string {
  const calMonth = ((idx + 3) % 12) + 1;
  const year = idx >= 9 ? fy + 1 : fy;
  return `${year}-${String(calMonth).padStart(2, "0")}-01`;
}

/** Last day of fiscal month `idx` of `fy`. */
export function fyMonthLastDay(fy: number, idx: number): string {
  return idx === 11 ? `${fy + 1}-03-31` : addDaysStr(fyMonthFirstDay(fy, idx + 1), -1);
}

export function fyFirstDay(fy: number): string {
  return `${fy}-04-01`;
}

export function fyLastDay(fy: number): string {
  return `${fy + 1}-03-31`;
}

/** "FY 2026-27". */
export function fyName(fy: number): string {
  return `FY ${fy}-${String(fy + 1).slice(-2)}`;
}

/**
 * Where `today` sits in fiscal year `fy`: how many whole months are behind it,
 * the share of the running month gone, and the share of the year gone. A past
 * year is fully elapsed; a future one has not begun.
 */
export function fyProgress(
  fy: number,
  today: string,
): { monthIdx: number; monthFraction: number; yearFraction: number; started: boolean; ended: boolean } {
  const here = fyOfDay(today);
  if (here > fy) return { monthIdx: 12, monthFraction: 0, yearFraction: 1, started: true, ended: true };
  if (here < fy) return { monthIdx: 0, monthFraction: 0, yearFraction: 0, started: false, ended: false };
  const monthIdx = fyMonthOfDay(today);
  const first = fyMonthFirstDay(fy, monthIdx);
  const last = fyMonthLastDay(fy, monthIdx);
  const monthFraction = (daysBetween(first, today) + 1) / (daysBetween(first, last) + 1);
  const yearFraction = (daysBetween(fyFirstDay(fy), today) + 1) / (daysBetween(fyFirstDay(fy), fyLastDay(fy)) + 1);
  return { monthIdx, monthFraction, yearFraction, started: true, ended: false };
}

// ── Quarters & timeline geometry ───────────────────────────────────────────

/** Fiscal quarter of a month index: Q1 = Apr–Jun (0) … Q4 = Jan–Mar (3). */
export function quarterOfMonth(monthIdx: number): number {
  return Math.floor(monthIdx / 3);
}

export function quarterRange(
  fy: number,
  q: number,
): { start: string; end: string; months: number[]; label: string } {
  const months = [q * 3, q * 3 + 1, q * 3 + 2];
  const start = fyMonthFirstDay(fy, months[0]);
  const end = fyMonthLastDay(fy, months[2]);
  const year = Number(end.slice(0, 4));
  return {
    start,
    end,
    months,
    label: `Q${q + 1} · ${FY_MONTHS[months[0]]} – ${FY_MONTHS[months[2]]} ${year}`,
  };
}

/** Inclusive day count of the overlap between [aStart, aEnd] and [bStart, bEnd]; 0 when apart. */
export function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  return s > e ? 0 : daysBetween(s, e) + 1;
}

/** The share of a campaign's budget that falls inside a date range, by days. */
export function prorateBudget(
  budget: number,
  start: string | null,
  end: string | null,
  rangeStart: string,
  rangeEnd: string,
): number {
  if (!start) return 0;
  const e = end ?? start;
  const total = daysBetween(start, e) + 1;
  if (total <= 0) return 0;
  return Math.round((budget * overlapDays(start, e, rangeStart, rangeEnd)) / total);
}

/**
 * A timeline bar's position inside a range, as percentages of the range's
 * width. Null when the campaign doesn't touch the range. `clippedStart` /
 * `clippedEnd` say the bar runs on beyond the visible range.
 */
export function timelineBar(
  start: string,
  end: string | null,
  rangeStart: string,
  rangeEnd: string,
): { left: number; width: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const e = end ?? start;
  if (overlapDays(start, e, rangeStart, rangeEnd) === 0) return null;
  const span = daysBetween(rangeStart, rangeEnd) + 1;
  const s = start < rangeStart ? rangeStart : start;
  const f = e > rangeEnd ? rangeEnd : e;
  const left = (daysBetween(rangeStart, s) / span) * 100;
  const width = ((daysBetween(s, f) + 1) / span) * 100;
  return {
    left: Math.round(left * 10) / 10,
    width: Math.round(width * 10) / 10,
    clippedStart: start < rangeStart,
    clippedEnd: e > rangeEnd,
  };
}

// ── Status ─────────────────────────────────────────────────────────────────

/** Stored status → what the planner shows. Approved runs as Live inside its dates and Done after them. */
export function displayStatus(
  status: string,
  startDate: string | null,
  endDate: string | null,
  today: string,
): DisplayStatus {
  if (status === "approved" && startDate) {
    const end = endDate ?? startDate;
    if (today > end) return "done";
    if (today >= startDate) return "live";
  }
  return (CAMPAIGN_STATUSES as readonly string[]).includes(status) ? (status as CampaignStatus) : "draft";
}

/** Statuses whose budget counts as planned spend (everything except ideas and cancellations). */
export function countsAsPlanned(status: string): boolean {
  return status !== "idea" && status !== "cancelled";
}

// ── Ledger attribution ─────────────────────────────────────────────────────

export type LedgerRowIn = {
  id: string;
  date: string;
  subItem: string;
  amount: number;
  /** Marketing's explicit tag, if any. campaignId null = "not a campaign's spend". */
  tag: { campaignId: string | null; lineId: string | null } | null;
};

export type CampaignWindow = {
  id: string;
  channelId: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

export type Attribution =
  | { mode: "tagged"; channelId: string | null; campaignId: string | null; lineId: string | null }
  | { mode: "auto"; channelId: string; campaignId: string; lineId: null }
  | { mode: "channel"; channelId: string; campaignId: null; lineId: null }
  | {
      mode: "review";
      channelId: string | null;
      campaignId: null;
      lineId: null;
      reason: "unmapped" | "ambiguous";
      candidates: string[];
    };

/**
 * Ledger sub-item → channel id. A sub-item claimed by two channels goes to the
 * first in sort order (the channel editor refuses a second claim, so this is
 * only a guard). Inactive channels still map: switching a channel off must not
 * make its past spend vanish from the totals.
 */
export function subItemChannelMap(
  channels: { id: string; sortOrder: number; ledgerSubItems: string[] }[],
): Map<string, string> {
  const map = new Map<string, string>();
  const ordered = [...channels].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const ch of ordered) {
    for (const s of ch.ledgerSubItems) if (!map.has(s)) map.set(s, ch.id);
  }
  return map;
}

/**
 * Which channel and campaign a Marketing ledger row belongs to.
 *
 * - An explicit tag always wins.
 * - Otherwise the sub-item decides the channel; a sub-item no channel claims
 *   goes to review ("unmapped").
 * - Within the channel, the approved campaigns running on the payment date are
 *   the candidates: exactly one → attributed automatically; two or more →
 *   review ("ambiguous"); none → channel-level spend with no campaign.
 *
 * Attribution is computed on read, never stored, so moving a campaign's dates
 * re-attributes untagged payments consistently. Tagging pins a row for good.
 */
export function attributeLedgerRow(
  row: LedgerRowIn,
  subItemMap: Map<string, string>,
  campaigns: CampaignWindow[],
): Attribution {
  const channelId = subItemMap.get(row.subItem) ?? null;
  if (row.tag) {
    return { mode: "tagged", channelId, campaignId: row.tag.campaignId, lineId: row.tag.lineId };
  }
  if (!channelId) {
    return { mode: "review", channelId: null, campaignId: null, lineId: null, reason: "unmapped", candidates: [] };
  }
  const candidates = campaigns.filter(
    (c) =>
      c.channelId === channelId &&
      (c.status === "approved" || c.status === "done") &&
      c.startDate !== null &&
      c.startDate <= row.date &&
      (c.endDate ?? c.startDate) >= row.date,
  );
  if (candidates.length === 1) {
    return { mode: "auto", channelId, campaignId: candidates[0].id, lineId: null };
  }
  if (candidates.length > 1) {
    return {
      mode: "review",
      channelId,
      campaignId: null,
      lineId: null,
      reason: "ambiguous",
      candidates: candidates.map((c) => c.id),
    };
  }
  return { mode: "channel", channelId, campaignId: null, lineId: null };
}

// ── Campaign money ─────────────────────────────────────────────────────────

export type CampaignMoney = {
  budget: number;
  paid: number;
  /** Promised and not yet paid: per budget line, committed minus paid, never negative. */
  committedUnpaid: number;
  /** Budget not yet paid or promised. */
  uncommitted: number;
  /** Paid + promised beyond the budget; 0 when inside it. */
  over: number;
  linesPlanned: number;
  byLine: Map<string | null, { committed: number; paid: number; unpaid: number }>;
};

/**
 * A campaign's money position. Commitments net off per budget line against what
 * the ledger shows paid on that line, so logging a payment needs no "mark as
 * paid" step: a ₹22,000 brochure quote with ₹12,000 paid leaves ₹10,000
 * committed. Payments and commitments without a line net off against each other.
 */
export function campaignMoney(input: {
  budget: number;
  lines: { id: string; planned: number }[];
  commitments: { lineId: string | null; amount: number; status: string }[];
  payments: { lineId: string | null; amount: number }[];
}): CampaignMoney {
  const byLine = new Map<string | null, { committed: number; paid: number; unpaid: number }>();
  const slot = (k: string | null) => {
    let v = byLine.get(k);
    if (!v) {
      v = { committed: 0, paid: 0, unpaid: 0 };
      byLine.set(k, v);
    }
    return v;
  };
  for (const c of input.commitments) {
    if (c.status === "cancelled") continue;
    slot(c.lineId).committed += c.amount;
  }
  let paid = 0;
  for (const p of input.payments) {
    slot(p.lineId).paid += p.amount;
    paid += p.amount;
  }
  let committedUnpaid = 0;
  byLine.forEach((v) => {
    v.unpaid = Math.max(0, v.committed - v.paid);
    committedUnpaid += v.unpaid;
  });
  const used = paid + committedUnpaid;
  return {
    budget: input.budget,
    paid,
    committedUnpaid,
    uncommitted: Math.max(0, input.budget - used),
    over: Math.max(0, used - input.budget),
    linesPlanned: input.lines.reduce((a, l) => a + l.planned, 0),
    byLine,
  };
}

// ── Pace ───────────────────────────────────────────────────────────────────

export type Pace = "over_budget" | "hot" | "on_pace" | "under" | "no_plan";
export const PACE_LABELS: Record<Pace, string> = {
  over_budget: "Over budget",
  hot: "Running hot",
  on_pace: "On pace",
  under: "Under-used",
  no_plan: "No plan yet",
};

/** Above this share of plan-to-date a channel is running hot. */
export const PACE_HOT = 1.1;
/** Below this share of plan-to-date a channel is under-used. */
export const PACE_UNDER = 0.8;

/**
 * Plan-to-date: whole months behind today plus the elapsed share of the running
 * month. A back-loaded plan (seminar season in November) therefore isn't flagged
 * as under-used in July just because most of its money sits later in the year.
 */
export function planToDate(monthly: number[], progress: { monthIdx: number; monthFraction: number }): number {
  let sum = 0;
  for (let i = 0; i < Math.min(progress.monthIdx, 12); i++) sum += monthly[i] ?? 0;
  if (progress.monthIdx < 12) sum += (monthly[progress.monthIdx] ?? 0) * progress.monthFraction;
  return Math.round(sum);
}

export function paceOf(input: { budget: number; spent: number; committed: number; planToDate: number }): Pace {
  if (input.spent + input.committed > input.budget) return "over_budget";
  if (input.planToDate <= 0) return input.spent > 0 ? "hot" : "no_plan";
  const ratio = input.spent / input.planToDate;
  if (ratio > PACE_HOT) return "hot";
  if (ratio < PACE_UNDER) return "under";
  return "on_pace";
}

/**
 * The fiscal month an unpaid commitment is expected to land in: its due month,
 * or the running month when it is overdue or undated. Null when it falls due in
 * a later fiscal year (it doesn't belong on this year's chart).
 */
export function commitmentMonth(dueDate: string | null, fy: number, today: string): number | null {
  const now = fyProgress(fy, today);
  const floor = now.ended ? 11 : now.monthIdx;
  if (!dueDate) return floor;
  const dueFy = fyOfDay(dueDate);
  if (dueFy > fy) return null;
  if (dueFy < fy) return floor;
  return Math.max(fyMonthOfDay(dueDate), floor);
}

// ── Formatting ─────────────────────────────────────────────────────────────

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** "₹1,60,000". */
export function formatInr(n: number): string {
  return `${n < 0 ? "−" : ""}₹${INR.format(Math.abs(Math.round(n)))}`;
}

/** "₹21.6L" / "₹0.90L" — lakh, one decimal from ₹10L up, two below. */
export function formatLakh(n: number): string {
  if (n === 0) return "₹0";
  const abs = Math.abs(n) / 100000;
  const s = abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  return `${n < 0 ? "−" : ""}₹${s}L`;
}

/** Thousands with Indian grouping, for the allocation grid: 1800000 → "1,800". */
export function formatThousands(n: number): string {
  return INR.format(Math.round(n / 1000));
}

/** Percent of a whole, 0 when the whole is 0. */
export function pctOf(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** Parse a rupee figure typed by a person: "1,60,000", "160000", "₹ 24,500". Null when not a whole non-negative amount. */
export function parseRupees(raw: string): number | null {
  const cleaned = raw.replace(/[₹,\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

/** Axis labels: "₹2.5L", "₹50k", "₹1.2Cr". */
export function compactRupees(n: number): string {
  const trim = (x: number) => String(Math.round(x * 10) / 10);
  if (n >= 10000000) return `₹${trim(n / 10000000)}Cr`;
  if (n >= 100000) return `₹${trim(n / 100000)}L`;
  if (n >= 1000) return `₹${trim(n / 1000)}k`;
  return `₹${Math.round(n)}`;
}

/** A round axis top: five equal steps from a 1–2–2.5–5 ladder that covers `max`. */
export function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 100000, step: 20000 };
  const raw = max / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return { top: step * 5, step };
}

// ── DTOs (server → client) ─────────────────────────────────────────────────

export type ChannelDto = {
  id: string;
  name: string;
  sortOrder: number;
  ledgerSubItems: string[];
  leadSourceIds: string[];
  active: boolean;
};

export type CampaignSummaryDto = {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  display: DisplayStatus;
  channelId: string | null;
  channelName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  startDate: string | null;
  endDate: string | null;
  budget: number;
  code: string | null;
};

export type UserOpt = { id: string; username: string };
