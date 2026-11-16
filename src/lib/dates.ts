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

/**
 * The instant the India calendar day `YYYY-MM-DD` begins (00:00 IST, i.e. 18:30
 * UTC the day before), optionally `offsetDays` later. `undefined` when the
 * string is absent or unparseable. Use it to turn a picked date into a
 * timestamp boundary — a UTC midnight would let the first 5½ hours of the
 * next IST day leak in.
 */
export function istDayStart(ymd: string | undefined, offsetDays = 0): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd ?? "").trim());
  if (!m) return undefined;
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + offsetDays);
  const d = new Date(utcMidnight - IST_OFFSET_MINUTES * 60_000);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Move a UTC-midnight day boundary (what `rangeFor` in period.ts produces) to
 * IST midnight on the same calendar date, so filtering a real timestamp by it
 * splits days where the office does.
 */
export function utcMidnightToIst(d: Date): Date {
  return new Date(d.getTime() - IST_OFFSET_MINUTES * 60_000);
}

const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

/**
 * `YYYY-MM-DD` of the India calendar day `at` falls on, whatever timezone the
 * browser is set to. "" when `at` is not a valid date.
 *
 * Browser-local getters (`getDate()` and friends) follow the viewer's OS clock.
 * A CRM task due "17 Nov" is stored as 17 Nov 00:00 UTC (05:30 IST), which a
 * laptop left on a US timezone reads as the evening of the 16th — "Due today"
 * a day early. Read task days through this instead.
 */
export function istDayKey(at: Date | string | number): string {
  const ms = new Date(at).getTime();
  if (Number.isNaN(ms)) return "";
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of the India calendar day `days` after the one `now` falls on. */
export function istDayKeyFrom(now: Date, days: number): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Whole calendar days from `fromKey` to `toKey`, both `YYYY-MM-DD`. */
export function dayKeyDiff(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

/** A `datetime-local` value (`YYYY-MM-DDTHH:mm`) showing `at` on India's wall clock. */
export function toIstWallClock(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * The instant a `datetime-local` value (`YYYY-MM-DDTHH:mm`) names, read as
 * India time — not the browser's. null when unparseable.
 */
export function fromIstWallClock(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - IST_OFFSET_MS;
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Proleptic Gregorian leap year. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
