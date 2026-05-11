/**
 * Lead Pulse date helpers. All Lead Pulse business logic uses IST
 * (Asia/Kolkata) calendar boundaries — including the 3-day backdate
 * window and the nightly lock job — so the user's local timezone never
 * skews "today" or "is this date locked".
 *
 * These helpers operate on plain `YYYY-MM-DD` strings to avoid
 * round-tripping through Date timezone arithmetic.
 */

export const IST_TZ = "Asia/Kolkata";
export const BACKDATE_DAYS = 3;

/** Format a Date as YYYY-MM-DD in IST. */
export function istDateString(date: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

/** Today in IST as YYYY-MM-DD. */
export function todayIst(): string {
  return istDateString(new Date());
}

/** Add N days to a YYYY-MM-DD string and return a new YYYY-MM-DD string. */
export function addDays(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Returns true when `date` is today − BACKDATE_DAYS or later (inclusive)
 *  and not in the future. The page lets users pick today plus the prior
 *  3 days; older or future dates are not editable from the UI. */
export function isWithinBackdateWindow(date: string, today: string = todayIst()): boolean {
  if (date > today) return false;
  const earliest = addDays(today, -BACKDATE_DAYS);
  return date >= earliest;
}

/** Convert a YYYY-MM-DD string into a Date suitable for Prisma `@db.Date`
 *  storage. We use the date at UTC midnight, which Postgres stores cleanly
 *  as a calendar date. */
export function toPrismaDate(yyyyMmDd: string): Date {
  return new Date(`${yyyyMmDd}T00:00:00.000Z`);
}

/** Convert a Prisma-returned Date back into a YYYY-MM-DD string. Date
 *  columns come back as a Date with UTC midnight; reading the UTC parts
 *  gives the correct calendar date. */
export function fromPrismaDate(d: Date): string {
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** YYYY-MM-DD for the first day of the month containing `yyyyMmDd`. */
export function firstOfMonth(yyyyMmDd: string): string {
  return yyyyMmDd.slice(0, 8) + "01";
}

/** Human label like "Wed, May 8" rendered in IST. */
export function formatIstShort(yyyyMmDd: string): string {
  const dt = toPrismaDate(yyyyMmDd);
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC", // already a pure-date value
  }).format(dt);
}
