import { prisma } from "./prisma";

// TEMPORARY (testing): widened to 90 to allow regularizing much older
// discrepancies during testing. Revert to 3 when done.
/** Working days excluding Sundays + holidays. */
export const REGULARIZATION_WINDOW_WORKING_DAYS = 90;

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
