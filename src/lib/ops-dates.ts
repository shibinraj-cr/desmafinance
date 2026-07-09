import type { Prisma, PrismaClient } from "@prisma/client";
import { addDays, istDateString, toPrismaDate, fromPrismaDate } from "./lead-pulse-dates";

/**
 * Operations SLA date maths. The ops team works a six-day week (Mon–Sat), so a
 * "business day" excludes Sundays and any date in the shared `Holiday` table.
 * All arithmetic is on `YYYY-MM-DD` IST calendar strings (same convention as
 * `lead-pulse-dates`) to avoid timezone drift.
 */

const SUNDAY = 0;

/** Day-of-week (0=Sun … 6=Sat) for a YYYY-MM-DD calendar date. */
function weekday(key: string): number {
  return toPrismaDate(key).getUTCDay();
}

/** A working day = Mon–Sat and not a holiday. */
export function isWorkingDay(key: string, holidays: ReadonlySet<string>): boolean {
  return weekday(key) !== SUNDAY && !holidays.has(key);
}

/**
 * Add `businessDays` working days to a start calendar date, stepping forward and
 * counting only working days (Mon–Sat, excluding holidays). `businessDays <= 0`
 * returns the start date unchanged. The start day itself is never counted — the
 * result is the date by which that many working days have elapsed.
 */
export function addBusinessDays(
  startKey: string,
  businessDays: number,
  holidays: ReadonlySet<string>,
): string {
  if (businessDays <= 0) return startKey;
  let key = startKey;
  let counted = 0;
  while (counted < businessDays) {
    key = addDays(key, 1);
    if (isWorkingDay(key, holidays)) counted++;
  }
  return key;
}

/** Today's IST calendar date as YYYY-MM-DD (the project start day). */
export function opsToday(): string {
  return istDateString(new Date());
}

/**
 * The IST calendar date (YYYY-MM-DD) a timestamp falls on — e.g. a task's
 * actual `completedAt` or a project's `createdAt`. Used as the anchor for the
 * rolling schedule, where a step's deadline is measured from the day the
 * previous step actually closed.
 */
export function opsDateKey(ts: Date): string {
  return istDateString(ts);
}

/** Re-export so callers can store an SLA date into a Prisma column cleanly. */
export { toPrismaDate as opsDateToPrisma };

/**
 * Load the shared holiday calendar as a set of YYYY-MM-DD strings, for the
 * business-day maths. Read-only — call once up front (outside the enroll
 * transaction), like the reviewer/classification lookups in `crm-enroll`.
 */
export async function loadHolidaySet(
  client: PrismaClient | Prisma.TransactionClient,
): Promise<Set<string>> {
  const rows = await client.holiday.findMany({ select: { date: true } });
  return new Set(rows.map((r) => fromPrismaDate(r.date)));
}
