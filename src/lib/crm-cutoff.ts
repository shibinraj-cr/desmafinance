/**
 * The daily contact cutoff — the deadline behind the daily lead report.
 *
 *   - Mon–Fri: 17:00 IST. Saturday: 15:30 IST. Sunday: no cutoff.
 *   - Holidays: no cutoff. The calendar is the shared `Holiday` table (the HR
 *     holiday list), loaded with `loadHolidaySet` from ops-dates.
 *
 * A lead assigned before a day's cutoff is due at that cutoff. One assigned at
 * or after it, on a Sunday, or on a holiday is due at the next working day's
 * cutoff (rules R3/R4). Handovers use the same deadline (H3).
 *
 * Every calculation is on the IST calendar — never the server's local time,
 * which is UTC on Vercel. Pure: no DB access.
 */
import { addDays, istDateString, toPrismaDate } from "./lead-pulse-dates";
import { isWorkingDay } from "./ops-dates";

/** IST is UTC+5:30, with no daylight saving. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SATURDAY = 6;

/** Minutes after IST midnight. */
export const WEEKDAY_CUTOFF_MINUTES = 17 * 60; // 17:00
export const SATURDAY_CUTOFF_MINUTES = 15 * 60 + 30; // 15:30

/**
 * How far ahead to look for a working day. Far beyond any real run of
 * holidays; past it the holiday calendar is ignored rather than failing an
 * assignment over a bad calendar.
 */
const LOOKAHEAD_DAYS = 60;

/** The cutoff instant on IST calendar day `day` (YYYY-MM-DD), or null when that day has none. */
export function cutoffOn(day: string, holidays: ReadonlySet<string>): Date | null {
  if (!isWorkingDay(day, holidays)) return null;
  const midnight = toPrismaDate(day);
  const minutes = midnight.getUTCDay() === SATURDAY ? SATURDAY_CUTOFF_MINUTES : WEEKDAY_CUTOFF_MINUTES;
  return new Date(midnight.getTime() + minutes * 60_000 - IST_OFFSET_MS);
}

function firstCutoffAfter(at: Date, holidays: ReadonlySet<string>): Date | null {
  let day = istDateString(at);
  for (let i = 0; i <= LOOKAHEAD_DAYS; i++, day = addDays(day, 1)) {
    const cutoff = cutoffOn(day, holidays);
    if (cutoff && at.getTime() < cutoff.getTime()) return cutoff;
  }
  return null;
}

/**
 * The deadline for something that arrives at `at`: the first cutoff strictly
 * after it. Arriving exactly at a cutoff counts as after it — there is no time
 * left that day.
 */
export function nextCutoff(at: Date, holidays: ReadonlySet<string>): Date {
  return firstCutoffAfter(at, holidays) ?? firstCutoffAfter(at, new Set())!;
}
