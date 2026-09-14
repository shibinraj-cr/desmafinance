/**
 * Fiscal-year date maths, parameterised by year.
 *
 * `period.ts` hard-codes FY 2026-27 (`FY_START`, `MONTH_LABELS`) because every
 * finance screen written before this one only ever looked at the running year.
 * The Expense Matrix puts two years beside each other, so it needs the same
 * maths keyed by the FY's opening calendar year: `2026` means Apr 2026 – Mar 2027.
 *
 * Ranges are half-open `[from, to)` at midnight UTC — the convention
 * `period.ts` and every aggregation in `aggregations.ts` already use.
 */

/** IST is UTC+5:30. "Which month are we in?" must be answered in the office's
 *  calendar, not the server's: on 1 Oct at 02:00 IST the server is still on
 *  30 Sep in UTC, and a UTC answer would leave October blank for five hours. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Calendar-month index (0 = Jan) of each fiscal month, Apr → Mar. */
const FY_MONTH_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2];

/** Column headings for the twelve fiscal months, in FY order. */
export const FY_MONTH_SHORT = [
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
  "Jan",
  "Feb",
  "Mar",
] as const;

/**
 * The first fiscal year DesGro's transaction ledger covers. Anything earlier
 * lives in the workbooks the business kept before the ledger existed, so a
 * year-on-year comparison below this simply has no other side — the UI says so
 * rather than drawing an empty bar and letting it read as zero spend.
 */
export const LEDGER_FIRST_FY = 2026;

/** 1 April of `fy`, inclusive. */
export function fyStart(fy: number): Date {
  return new Date(Date.UTC(fy, 3, 1));
}

/** 1 April of the following year, exclusive. */
export function fyEnd(fy: number): Date {
  return new Date(Date.UTC(fy + 1, 3, 1));
}

/** "FY 2026-27". */
export function fyLabel(fy: number): string {
  return `FY ${fy}-${String(fy + 1).slice(-2)}`;
}

/** Start of one fiscal month, `idx` counted from April (0 = Apr, 11 = Mar). */
export function fyMonthStart(fy: number, idx: number): Date {
  return new Date(Date.UTC(fy + (idx >= 9 ? 1 : 0), FY_MONTH_ORDER[idx], 1));
}

/**
 * Which fiscal year a date belongs to. Jan–Mar fall in the year that opened
 * the previous April, so 15 Feb 2027 is FY 2026-27, not FY 2027-28.
 */
export function fyForDate(d: Date): number {
  return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

/** Position of a date within its fiscal year: 0 for April … 11 for March. */
export function fyMonthIndex(d: Date): number {
  return (d.getUTCMonth() + 9) % 12;
}

/** `Transaction.month` labels for one FY, in FY order: ["Apr-26", … "Mar-27"]. */
export function fyMonthLabels(fy: number): string[] {
  return FY_MONTH_SHORT.map(
    (m, i) => `${m}-${String(fy + (i >= 9 ? 1 : 0)).slice(-2)}`,
  );
}

/** The fiscal year in progress right now, read off the IST calendar. */
export function currentFy(now: Date = new Date()): number {
  return fyForDate(new Date(now.getTime() + IST_OFFSET_MS));
}

/**
 * How many of the FY's months have begun as at `now`. A month counts the
 * moment it starts, so the running month is included — partially filled, which
 * is honest — while months still ahead stay blank instead of reading as a
 * collapse in spend. A finished FY returns 12; one not yet started, 0.
 */
export function postedMonthCount(fy: number, now: Date = new Date()): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const here = fyForDate(ist);
  if (here > fy) return 12;
  if (here < fy) return 0;
  return fyMonthIndex(ist) + 1;
}

/**
 * Fiscal years the ledger can speak for, newest first — what the year picker
 * offers. Never reaches below `LEDGER_FIRST_FY`, so the picker cannot point at
 * a year for which the answer is guaranteed to be an empty page.
 */
export function selectableFys(now: Date = new Date()): number[] {
  const latest = Math.max(currentFy(now), LEDGER_FIRST_FY);
  const years: number[] = [];
  for (let y = latest; y >= LEDGER_FIRST_FY; y--) years.push(y);
  return years;
}

/** Reads `?fy=` into a fiscal year, falling back to the running one. */
export function parseFy(raw: string | undefined, now: Date = new Date()): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) return currentFy(now);
  const allowed = selectableFys(now);
  return allowed.includes(n) ? n : currentFy(now);
}
