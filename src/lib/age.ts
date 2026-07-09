// Pure date-of-birth ↔ age helpers. No prisma / server imports, so this module
// is safe to import from both server code and client components.
//
// All boundary math is done in UTC to line up with how a Prisma `@db.Date`
// column is stored (midnight UTC). A candidate's `dob` is date-only, so the
// exact time-of-day / timezone never matters here beyond the calendar day.

/**
 * Whole years elapsed from `dob` to `now` (i.e. the candidate's current age).
 * Returns null for a missing, invalid, or future date of birth.
 */
export function ageFromDob(dob: Date | string | null | undefined, now: Date): number | null {
  if (!dob) return null;
  const b = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(b.getTime())) return null;

  let age = now.getUTCFullYear() - b.getUTCFullYear();
  // Subtract a year if this year's birthday hasn't happened yet. When the month
  // matches, fall back to the day comparison (a birthday *today* does not decrement).
  const monthDiff = now.getUTCMonth() - b.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < b.getUTCDate())) age--;

  return age < 0 ? null : age;
}

/**
 * Translate an inclusive age filter `[minAge, maxAge]` into an equivalent
 * date-of-birth range (UTC-midnight bounds), so the leads list can filter by age
 * using an indexed `dob` column instead of computing age per-row.
 *
 *   age >= minAge      ⟺  born on/before `minAge` years ago            → dob <= that day
 *   age <= maxAge      ⟺  born strictly after `(maxAge + 1)` years ago → dob >= that day + 1
 *
 * Returns null when neither bound is supplied.
 */
export function dobRangeForAge(
  minAge: number | undefined,
  maxAge: number | undefined,
  now: Date,
): { gte?: Date; lte?: Date } | null {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const range: { gte?: Date; lte?: Date } = {};

  if (minAge !== undefined && Number.isFinite(minAge)) {
    range.lte = new Date(Date.UTC(y - minAge, m, d));
  }
  if (maxAge !== undefined && Number.isFinite(maxAge)) {
    // +1 day so someone whose (maxAge+1)-th birthday is exactly today is excluded.
    range.gte = new Date(Date.UTC(y - maxAge - 1, m, d + 1));
  }

  return range.gte || range.lte ? range : null;
}

/**
 * Parse an age query-string value into a clamped non-negative integer, or
 * undefined when absent / out of a sane 0–150 range. Shared by every list
 * endpoint so the age filter behaves identically everywhere.
 */
export function parseAgeParam(v: string | null | undefined): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n) || n < 0 || n > 150) return undefined;
  return n;
}

/**
 * Normalise a `YYYY-MM-DD` form value into a UTC-midnight Date for a `@db.Date`
 * column. Distinguishes "not provided" (undefined) from "clear it" (null):
 *   - undefined      → undefined (field omitted from the update)
 *   - "" or null     → null      (clear the stored value)
 *   - "YYYY-MM-DD"   → Date at UTC midnight
 * Throws on any other (malformed) value.
 */
export function parseDobInput(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v.trim() === "") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Date of birth must be YYYY-MM-DD");
  const dt = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) throw new Error("Invalid date of birth");
  return dt;
}

/**
 * Best-effort parse of a date-of-birth cell from an imported spreadsheet into a
 * UTC-midnight Date (or null if empty / unrecognised — never throws, so one bad
 * cell can't fail a bulk import). Handles:
 *   - a real Excel date cell (arrives as a JS Date via `cellDates: true`)
 *   - ISO `YYYY-MM-DD`
 *   - day-first `DD/MM/YYYY` or `DD-MM-YYYY` (the Indian convention used here),
 *     disambiguated to MM/DD when the first component is clearly a month (>12).
 */
export function parseDobCell(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  const s = String(v).trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return utcDate(+iso[1], +iso[2], +iso[3]);

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) {
    let day = +dmy[1];
    let month = +dmy[2];
    // First component can't be a month (>12) → it's the day (day-first). If the
    // second is >12 it must be the day → swap to month-first.
    if (day <= 12 && month > 12) [day, month] = [month, day];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return utcDate(+dmy[3], month, day);
  }
  return null;
}

function utcDate(year: number, month1: number, day: number): Date | null {
  const dt = new Date(Date.UTC(year, month1 - 1, day));
  if (Number.isNaN(dt.getTime())) return null;
  // Reject overflow (e.g. 31/02 → Mar 3) so a malformed date isn't silently accepted.
  if (dt.getUTCMonth() !== month1 - 1 || dt.getUTCDate() !== day) return null;
  return dt;
}
