/**
 * Pure scheduling rules: when the daily run is due, when the next one is, and
 * what counts as a bank business day for the "no statement received" alert.
 */

/** Wall-clock date and minute-of-day in `timeZone`. */
export function zonedParts(now: Date, timeZone: string): { date: string; minutes: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** "09:30" → 570; null when malformed. */
export function parseRunTime(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Due once per local day, at or after the configured time. */
export function isScheduledRunDue(opts: {
  now: Date;
  enabled: boolean;
  runTime: string;
  timeZone: string;
  lastScheduledRunOn: string | null;
}): boolean {
  if (!opts.enabled) return false;
  const at = parseRunTime(opts.runTime);
  if (at === null) return false;
  const { date, minutes } = zonedParts(opts.now, opts.timeZone);
  return minutes >= at && opts.lastScheduledRunOn !== date;
}

/** Local date + time of the next scheduled run, for display. */
export function nextScheduledRun(opts: {
  now: Date;
  enabled: boolean;
  runTime: string;
  timeZone: string;
  lastScheduledRunOn: string | null;
}): { date: string; time: string } | null {
  if (!opts.enabled || parseRunTime(opts.runTime) === null) return null;
  const { date, minutes } = zonedParts(opts.now, opts.timeZone);
  const at = parseRunTime(opts.runTime)!;
  const today = opts.lastScheduledRunOn === date ? false : true;
  if (today && minutes < at) return { date, time: opts.runTime };
  if (today) return { date, time: "within 5 min" };
  return { date: addIsoDays(date, 1), time: opts.runTime };
}

export function addIsoDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Indian banks close on Sundays and on the 2nd and 4th Saturday of the month;
 * every other day may carry a statement. Public holidays vary by state and are
 * not modelled — the alert threshold (default 2 business days) absorbs one.
 */
export function isBankBusinessDay(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  if (dow === 0) return false;
  if (dow === 6) {
    const nth = Math.ceil(d.getUTCDate() / 7);
    if (nth === 2 || nth === 4) return false;
  }
  return true;
}

/**
 * Business days strictly after the last statement day and before today — the
 * days whose statement should already have arrived. Today is excluded because
 * its statement is normally e-mailed the next morning.
 */
export function missedBusinessDays(lastStatementDate: string, today: string): number {
  let n = 0;
  for (let d = addIsoDays(lastStatementDate, 1); d < today; d = addIsoDays(d, 1)) {
    if (isBankBusinessDay(d)) n++;
    if (n > 60) break;
  }
  return n;
}
