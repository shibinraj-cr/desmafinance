/**
 * Historical candidate payments: money a candidate paid before DesGro's
 * ledger began on 1 Apr 2026 (the start of FY 2026-27, see `period.ts`).
 *
 * Finance enters these so a candidate's "paid so far" and balance are right,
 * but the books before that date were never kept in DesGro, so a handful of
 * typed-in old payments would make any report over that period wrong. Every
 * finance report therefore reads the live ledger only (`isHistorical: false`).
 *
 * Whether a row is historical follows from its date alone:
 *   1 Apr 2023 .. 31 Mar 2026  → historical (candidate payments only)
 *   Apr 2026 onwards (MONTHS)  → live, as before
 *
 * Pure and client-safe: no Prisma import, so forms can use the same rules.
 */

/** Earliest date a historical payment may carry. */
export const HISTORICAL_FROM_ISO = "2023-04-01";
/** Last day before DesGro's ledger began; the latest historical date. */
export const HISTORICAL_TO_ISO = "2026-03-31";
/** First day of the live ledger. */
export const LEDGER_GO_LIVE_ISO = "2026-04-01";

const HISTORICAL_FROM_MS = Date.UTC(2023, 3, 1);
const GO_LIVE_MS = Date.UTC(2026, 3, 1);

/** Short label used on badges and filters. */
export const HISTORICAL_LABEL = "Before DesGro";

function toMs(d: Date | string): number {
  return typeof d === "string" ? Date.parse(d) : d.getTime();
}

/** True for any date before the live ledger began. This is what sets
 *  `Transaction.isHistorical`; an unparseable date is never historical. */
export function isHistoricalDate(d: Date | string): boolean {
  const ms = toMs(d);
  return Number.isFinite(ms) && ms < GO_LIVE_MS;
}

/** True when a historical date is too old to accept. */
export function isBeforeHistoricalFloor(d: Date | string): boolean {
  const ms = toMs(d);
  return Number.isFinite(ms) && ms < HISTORICAL_FROM_MS;
}

/** Candidate payments are booked under "Sales - …" (first payment) or
 *  "Collection - …" (later instalments). Nothing else may be historical. */
export const CANDIDATE_PAYMENT_PREFIXES = ["Sales - ", "Collection - "] as const;

export function isCandidatePaymentCategory(category: string): boolean {
  return CANDIDATE_PAYMENT_PREFIXES.some((p) => category.startsWith(p));
}
