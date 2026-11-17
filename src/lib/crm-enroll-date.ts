/**
 * Which enrollment dates may be entered. Pure and client-safe: the Enroll
 * dialog uses it for the date picker's limits, and `enrollLead` enforces it,
 * so web, the mobile app and scripts all get the same rule.
 *
 * An enrollment counts in the month of its date everywhere: Lead Pulse, BDE
 * targets, incentive. A free-typed date once put a July enrollment into
 * November. So:
 *   - never in the future (IST);
 *   - normally no earlier than the 1st of the current month. For the first
 *     week of a month the previous month is still open, for a deal that
 *     closed at month-end and was keyed in the next morning;
 *   - anything older needs someone who may also un-enroll (admin, Lead Pulse
 *     supervisor, CRM manager), for corrections and old candidates.
 *
 * Dates are IST calendar days as `YYYY-MM-DD`; string order is date order.
 */

/** Up to and including this day of a month, the previous month is still open. */
export const ENROLL_PREVIOUS_MONTH_OPEN_UNTIL_DAY = 7;

export type EnrollDateProblem = "enroll_date_in_future" | "enroll_date_too_old";

/** The earliest date a user without back-dating rights may enroll on. */
export function earliestEnrollDate(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  if (d > ENROLL_PREVIOUS_MONTH_OPEN_UNTIL_DAY) return `${today.slice(0, 8)}01`;
  const prevYear = m === 1 ? y - 1 : y;
  const prevMonth = m === 1 ? 12 : m - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
}

export function enrollDateProblem(
  date: string,
  today: string,
  opts: { canBackdate: boolean },
): EnrollDateProblem | null {
  if (date > today) return "enroll_date_in_future";
  if (!opts.canBackdate && date < earliestEnrollDate(today)) return "enroll_date_too_old";
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1 Nov 2026". */
export function formatEnrollDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function enrollDateMessage(problem: EnrollDateProblem, today: string): string {
  if (problem === "enroll_date_in_future") {
    return "The enrollment date can't be in the future. Use the day the candidate paid.";
  }
  return `Enrollments can be dated from ${formatEnrollDate(earliestEnrollDate(today))} onwards. For an older date, ask an admin or your sales head to enroll the candidate.`;
}
