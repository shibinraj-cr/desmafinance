/**
 * Pure attendance-status rules shared by the leave-decision and regularization
 * flows. No DB access — safe to import anywhere and unit-test directly.
 */

/** A day has a punch if either the in- or out-time is recorded. */
export function hasPunch(inTime: string | null, outTime: string | null): boolean {
  return !!(inTime || outTime);
}

/**
 * A day with any punch is a worked day and must resolve to a present status
 * (P / HD / OD / REG). It can NEVER be reclassified as paid leave (LV) or full
 * absence (A) — a half-day is the most a punched day can be docked. If a punch
 * is wrong, fix it via Regularization instead of marking the day as leave.
 *
 * Returns true when the proposed status would violate that rule for a punched
 * day (so the caller can reject it).
 */
export function leaveStatusBlockedByPunch(
  newStatus: string,
  inTime: string | null,
  outTime: string | null,
): boolean {
  return hasPunch(inTime, outTime) && (newStatus === "LV" || newStatus === "A");
}
