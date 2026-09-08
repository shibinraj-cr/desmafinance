/**
 * Parse a date value coming from sources we don't fully control:
 *  - JS Date — passed through
 *  - Excel serial number (days since 1899-12-30) — converted
 *  - Strings in dd-mm-yyyy or dd/mm/yyyy (Indian/UK) — explicit match
 *  - Anything else — fall back to native Date parsing
 *
 * Returns null when the input cannot be parsed. Used by the Excel
 * importer; safe to use anywhere we accept user-pasted dates.
 */
export function parseLooseDate(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(+v) ? null : v;

  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86400000);
    return isNaN(+d) ? null : d;
  }

  if (typeof v === "string" && v) {
    const s = v.trim();
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
      return isNaN(+d) ? null : d;
    }
    const d = new Date(s);
    return isNaN(+d) ? null : d;
  }

  return null;
}

/**
 * India Standard Time is a fixed UTC+05:30 with no daylight saving, so an
 * offset shift is exact — no timezone database needed.
 *
 * Everything else in this codebase treats "today" as a UTC calendar day, which
 * is fine for anything derived from a stored `@db.Date`. It is NOT fine for
 * anything that has to agree with the wall clock in the office: a UTC day flips
 * at 05:30 IST, so between midnight and dawn a UTC "today" is still yesterday
 * for the people looking at the screen. Use this wherever a date has to match
 * what the user believes the date is.
 */
const IST_OFFSET_MINUTES = 330;

export type CalendarDay = { year: number; month: number; day: number };

/** The calendar day it currently is in India. `month` is 1-based. */
export function istToday(now: Date = new Date()): CalendarDay {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Proleptic Gregorian leap year. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
