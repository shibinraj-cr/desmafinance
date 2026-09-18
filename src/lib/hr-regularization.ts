import { prisma } from "./prisma";

/**
 * How far BACK a request about a past date may reach, in working days
 * (Sundays and HR holidays excluded).
 *
 * Was left at 90 with a "TEMPORARY (testing) … revert to 3" note, almost
 * certainly in response to employees finding they could not file for older
 * dates. That was treating the wrong cause: the blocker was the sync deleting
 * the attendance rows the apply form is built from, not this window.
 *
 * Settable per deployment without a code change; the default is the policy
 * value agreed with the business.
 */
export const REGULARIZATION_WINDOW_WORKING_DAYS = Number(
  process.env.HR_REGULARIZATION_WINDOW_DAYS ?? 10,
);

/**
 * Return true if `today - discrepancyDate` is within the
 * REGULARIZATION_WINDOW_WORKING_DAYS working-day window. Sundays and
 * HR holidays don't count.
 */
export async function isWithinRegularizationWindow(
  discrepancyDate: Date,
  today: Date = new Date(),
): Promise<boolean> {
  if (discrepancyDate > today) return false;
  if (discrepancyDate.toDateString() === today.toDateString()) return true;
  // Count working days strictly between (discrepancy, today].
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: discrepancyDate, lte: today } },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
  let working = 0;
  const cur = new Date(discrepancyDate);
  cur.setUTCDate(cur.getUTCDate() + 1);
  while (cur <= today) {
    const dow = cur.getUTCDay();
    const key = cur.toISOString().slice(0, 10);
    if (dow !== 0 && !holidaySet.has(key)) working++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return working <= REGULARIZATION_WINDOW_WORKING_DAYS;
}

export const REGULARIZATION_REASONS = [
  { code: "missing_punch", label: "Missing punch" },
  { code: "wrong_in_time", label: "Wrong in-time" },
  { code: "wrong_out_time", label: "Wrong out-time" },
  { code: "biometric_sync", label: "Biometric sync issue" },
  { code: "forgot_punch", label: "Forgot to punch" },
  { code: "other", label: "Other" },
] as const;

/**
 * The two halves of a working day an employee can apply for separately.
 *
 * The codes deliberately match the "AM"/"PM" vocabulary the sandwich rule
 * already speaks (`inferHdLeaveHalf`), so a DECLARED half and an INFERRED one
 * are the same value and the bridging logic needs no translation layer.
 *
 * A half-day leave resolves the day to HD — a 0.5-day deduction that the
 * monthly paid-leave allocation covers where the balance reaches it (see
 * `cycleMonthLop` / `paidLeaveCoveredByDay`). That is also why HD is the only
 * leave shape allowed on a day that already carries a punch: half a worked day
 * can be docked, a whole one can't.
 */
export const HALF_SESSIONS = [
  { code: "AM", label: "First half (morning)" },
  { code: "PM", label: "Second half (afternoon)" },
] as const;

export type HalfSession = (typeof HALF_SESSIONS)[number]["code"];

export function isHalfSession(v: unknown): v is HalfSession {
  return v === "AM" || v === "PM";
}

/** "First half" / "Second half" for display, or null for a full day. */
export function halfSessionLabel(code: string | null | undefined): string | null {
  if (code === "AM") return "First half";
  if (code === "PM") return "Second half";
  return null;
}

/**
 * The half an employee most likely wants off on an existing half-day row, used
 * to preselect the radio. Arrived late → the morning is the missing half;
 * left early → the afternoon is. Same reading as `inferHdLeaveHalf`, but it
 * commits to "AM" when the punches are ambiguous rather than returning null —
 * a preselected radio the employee can change beats an empty one.
 */
export function suggestHalfSession(d: {
  lateMinutes: number | null;
  earlyOutMinutes: number | null;
}): HalfSession {
  return (d.earlyOutMinutes ?? 0) > (d.lateMinutes ?? 0) ? "PM" : "AM";
}
