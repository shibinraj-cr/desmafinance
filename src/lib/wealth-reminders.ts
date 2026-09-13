import { addDays, todayIst } from "./lead-pulse-dates";

/**
 * Turning a holding's schedule ("the 20th, monthly" / "10 October, yearly")
 * into dated money events.
 *
 * Everything here is pure and works on `YYYY-MM-DD` IST calendar strings, the
 * same convention as lead-pulse-dates and ops-dates — no Date arithmetic that
 * can drift across a timezone. The database side lives in lib/wealth.ts.
 */

export type WealthFrequency =
  | "monthly"
  | "quarterly"
  | "yearly"
  | "three_yearly"
  | "one_time"
  | "none";

export const WEALTH_FREQUENCIES: WealthFrequency[] = [
  "monthly",
  "quarterly",
  "yearly",
  "three_yearly",
  "one_time",
  "none",
];

/** How many months one cycle advances. `null` = does not repeat. */
const STEP_MONTHS: Record<WealthFrequency, number | null> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
  three_yearly: 36,
  one_time: null,
  none: null,
};

export type WealthSchedule = {
  frequency: WealthFrequency;
  /** For monthly schedules: the day the money moves. 1–31, clamped per month. */
  dueDayOfMonth?: number | null;
  /** For every other repeating schedule: the anchor date the cycle repeats from. */
  renewalOn?: string | null;
};

export type DueBucket = "overdue" | "due_soon" | "upcoming";

/** Days in a given month (1-indexed month). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymd(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m, d];
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Add whole months to a calendar date, clamping the day to the target month's
 * length: 31 Jan + 1 month = 28 Feb (29 in a leap year), not 3 March.
 *
 * Always call this from the ORIGINAL anchor with a multiple of the step, never
 * iteratively — stepping month by month from a clamped result would walk a
 * 31st-of-the-month schedule permanently down to the 28th.
 */
export function addMonthsClamped(key: string, months: number): string {
  const [y, m, d] = ymd(key);
  const total = (y * 12 + (m - 1)) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return fmt(ty, tm, Math.min(d, daysInMonth(ty, tm)));
}

/**
 * The first occurrence on or after `fromKey`, or null when the schedule does
 * not produce one (no anchor, `none`, or a one-time date already past).
 */
export function nextDueOn(schedule: WealthSchedule, fromKey: string = todayIst()): string | null {
  const { frequency } = schedule;
  if (frequency === "none") return null;

  if (frequency === "monthly") {
    const day = schedule.dueDayOfMonth;
    // A monthly schedule can also be anchored on a date, which is how an
    // imported row with no explicit day-of-month still works.
    if (day == null) return schedule.renewalOn ? steppedFromAnchor(schedule, fromKey, 1) : null;
    if (day < 1 || day > 31) return null;
    const [y, m] = ymd(fromKey);
    // This month's occurrence, then next month's if it has already passed.
    for (let i = 0; i < 2; i++) {
      const total = y * 12 + (m - 1) + i;
      const ty = Math.floor(total / 12);
      const tm = (total % 12) + 1;
      const candidate = fmt(ty, tm, Math.min(day, daysInMonth(ty, tm)));
      if (candidate >= fromKey) return candidate;
    }
    return null;
  }

  const step = STEP_MONTHS[frequency];
  if (step === null) {
    // one_time: the anchor itself, and only while it is still ahead.
    const anchor = schedule.renewalOn;
    if (!anchor) return null;
    return anchor >= fromKey ? anchor : null;
  }
  return steppedFromAnchor(schedule, fromKey, step);
}

/** Walk an anchored cycle forward (or back) to the first date >= fromKey. */
function steppedFromAnchor(
  schedule: WealthSchedule,
  fromKey: string,
  stepMonths: number,
): string | null {
  const anchor = schedule.renewalOn;
  if (!anchor) return null;

  const [ay, am] = ymd(anchor);
  const [fy, fm] = ymd(fromKey);
  // Jump straight to the right neighbourhood instead of looping from the
  // anchor — an anchor a decade back would otherwise cost 120 iterations.
  const monthsApart = (fy * 12 + (fm - 1)) - (ay * 12 + (am - 1));
  let cycles = Math.floor(monthsApart / stepMonths);
  if (cycles < 0) cycles = 0;

  // Step back one cycle first so a same-month occurrence earlier in the month
  // is not skipped, then forward until we land on or after fromKey.
  cycles = Math.max(0, cycles - 1);
  for (let i = 0; i < 5; i++) {
    const candidate = addMonthsClamped(anchor, (cycles + i) * stepMonths);
    if (candidate >= fromKey) return candidate;
  }
  return null;
}

/**
 * Every occurrence in the window [fromKey, untilKey], oldest first. Capped so a
 * misconfigured schedule can never generate an unbounded list.
 */
export function occurrencesBetween(
  schedule: WealthSchedule,
  fromKey: string,
  untilKey: string,
  cap = 60,
): string[] {
  const out: string[] = [];
  let cursor = fromKey;
  while (out.length < cap) {
    const next = nextDueOn(schedule, cursor);
    if (!next || next > untilKey) break;
    out.push(next);
    // Advance past the date just emitted so the next call cannot repeat it.
    cursor = addDays(next, 1);
    if (schedule.frequency === "one_time") break;
  }
  return out;
}

/**
 * Where a due date sits relative to today: past its date, inside its lead
 * window, or still ahead. `leadDays` is per-holding — a ₹4.5L renewal is worth
 * six weeks of warning, a ₹927 premium three days.
 */
export function bucketFor(dueOn: string, leadDays: number, today: string = todayIst()): DueBucket {
  if (dueOn < today) return "overdue";
  const windowOpensOn = addDays(dueOn, -Math.max(0, leadDays));
  return today >= windowOpensOn ? "due_soon" : "upcoming";
}

/** Whole days from today to the due date. Negative = already past. */
export function daysUntil(dueOn: string, today: string = todayIst()): number {
  const [y1, m1, d1] = ymd(today);
  const [y2, m2, d2] = ymd(dueOn);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}

export type ReminderLike = {
  id: string;
  dueOn: string;
  status: string;
  amount: number | null;
  leadDays: number;
  notifiedAt?: Date | string | null;
};

/**
 * Open reminders that have entered their lead window (or gone past due) and
 * have not been notified yet. This is what the daily cron acts on; keeping it
 * pure is what makes it testable without a database.
 */
export function remindersToRaise<T extends ReminderLike>(
  reminders: readonly T[],
  today: string = todayIst(),
): T[] {
  return reminders.filter((r) => {
    if (r.status !== "open") return false;
    if (r.notifiedAt) return false;
    return bucketFor(r.dueOn, r.leadDays, today) !== "upcoming";
  });
}

/** Split reminders into the three bands the page's attention rail renders. */
export function groupByBucket<T extends ReminderLike>(
  reminders: readonly T[],
  today: string = todayIst(),
): Record<DueBucket, T[]> {
  const out: Record<DueBucket, T[]> = { overdue: [], due_soon: [], upcoming: [] };
  for (const r of reminders) {
    if (r.status !== "open") continue;
    out[bucketFor(r.dueOn, r.leadDays, today)].push(r);
  }
  for (const k of Object.keys(out) as DueBucket[]) {
    out[k].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  }
  return out;
}

/**
 * What the schedule costs in a year, normalised. Used for the "annual
 * commitment" headline — a 3-yearly premium counts as a third of itself, so
 * monthly SIPs and multi-year policies can be added together honestly.
 */
export function annualisedContribution(
  amount: number | null | undefined,
  frequency: WealthFrequency,
): number {
  if (!amount || amount <= 0) return 0;
  switch (frequency) {
    case "monthly":
      return amount * 12;
    case "quarterly":
      return amount * 4;
    case "yearly":
      return amount;
    case "three_yearly":
      return amount / 3;
    default:
      return 0; // one-time and unscheduled money is not a recurring commitment
  }
}
