/**
 * Overnight quiet hours for the database: 22:30 to 06:30 IST.
 *
 * Neon bills compute only while the database is awake, and puts it to sleep
 * after 5 idle minutes. Anything on a timer that touches it more often than
 * that keeps it awake all night for nobody. So during these hours:
 *   - vercel.json's every-5-minute crons (crm-broadcasts, lead-cutoff,
 *     bank-statements) are scheduled for hours 1-16 UTC only, i.e. their last
 *     tick is 22:25 IST and their first is 06:30 IST;
 *   - the lead-sheet Apps Script still reads its sheet every minute and sends a
 *     new lead the moment it appears, but sends its empty "still here" check-in
 *     only once per clock half-hour (QUIET_HEARTBEAT_MINUTES), so both sheets
 *     wake the database together.
 * Real traffic (a webhook, a lead, a person) still wakes the database whenever
 * it arrives. This only stops the clockwork from keeping it up.
 * tests/db-quiet-hours.test.ts holds vercel.json to it.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const DAY_MINUTES = 24 * 60;

/** Minute of the IST day at which quiet hours begin (22:30). */
export const QUIET_START_IST_MINUTE = 22 * 60 + 30;
/** Minute of the IST day at which quiet hours end (06:30). */
export const QUIET_END_IST_MINUTE = 6 * 60 + 30;
/** How often the lead sheets check in with nothing to send during quiet hours. */
export const QUIET_HEARTBEAT_MINUTES = 30;

/** Minute of the day in IST (UTC+5:30, no daylight saving), 0–1439. */
export function istMinuteOfDay(d: Date): number {
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET_MINUTES) % DAY_MINUTES;
}

export function inDbQuietHours(d: Date): boolean {
  const m = istMinuteOfDay(d);
  return m >= QUIET_START_IST_MINUTE || m < QUIET_END_IST_MINUTE;
}
