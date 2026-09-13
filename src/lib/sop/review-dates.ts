/**
 * SOP review-schedule maths.
 *
 * Dates here are pure calendar dates — stored as `@db.Date` and reasoned about
 * in UTC, the same convention the rest of the app uses for `@db.Date` columns.
 * "Today" is the IST calendar day (src/lib/dates.ts): a review that falls due
 * on the 14th must read as due on the 14th to someone sitting in the office,
 * not from 05:30 on the 14th because that is when the UTC day flips.
 *
 * Nothing here schedules anything. The buckets are DERIVED on every read, so a
 * corrected next-review date is right immediately and there is no nightly job
 * whose failure would silently freeze the dashboard.
 */

import { istToday } from "@/lib/dates";
import type { ReviewFrequency } from "./constants";

/** A calendar date at UTC midnight — what a `@db.Date` column round-trips as. */
export function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Today, as a UTC-midnight Date, using the IST calendar day. */
export function today(now: Date = new Date()): Date {
  const t = istToday(now);
  return utcDate(t.year, t.month, t.day);
}

/** Strip any time component so two dates compare as calendar days. */
export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  const out = startOfDay(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Add months, clamped to the end of the target month. 31 Jan + 1 month is
 * 28 Feb, not 3 March — a review scheduled for month-end should stay at
 * month-end rather than drifting into the next one.
 */
export function addMonths(d: Date, months: number): Date {
  const base = startOfDay(d);
  const day = base.getUTCDate();
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

/**
 * The next review date implied by a frequency, counted from `from`.
 * Returns null for a frequency that carries no interval (custom with no
 * `intervalDays`, or no frequency at all) — the caller then keeps whatever the
 * author typed by hand.
 */
export function computeNextReviewDate(
  from: Date,
  frequency: ReviewFrequency | string | null | undefined,
  intervalDays?: number | null,
): Date | null {
  if (!frequency) return null;
  switch (frequency) {
    case "weekly":
      return addDays(from, 7);
    case "monthly":
      return addMonths(from, 1);
    case "quarterly":
      return addMonths(from, 3);
    case "half_yearly":
      return addMonths(from, 6);
    case "yearly":
      return addMonths(from, 12);
    case "custom":
      return intervalDays && intervalDays > 0 ? addDays(from, intervalDays) : null;
    default:
      return null;
  }
}

// ── Due buckets ─────────────────────────────────────────────────────────────

export type ReviewBucket = "overdue" | "due_today" | "due_soon" | "scheduled" | "none";

export const REVIEW_BUCKET_LABELS: Record<ReviewBucket, string> = {
  overdue: "Review Overdue",
  due_today: "Review Due Today",
  due_soon: "Review Due Soon",
  scheduled: "Scheduled",
  none: "No review scheduled",
};

export const REVIEW_BUCKET_CLASSES: Record<ReviewBucket, string> = {
  overdue: "bg-error-container text-on-error-container",
  due_today: "bg-primary text-on-primary",
  due_soon: "bg-primary-fixed text-on-primary",
  scheduled: "bg-surface-container-high text-on-surface-variant",
  none: "bg-surface-container text-on-surface-variant",
};

/**
 * Which bucket a next-review date falls in.
 *
 * `reminderDays` is the SOP's own lead time (7 / 15 / 30 / custom) rather than
 * a module-wide constant, because a weekly-reviewed SOP and an annually-
 * reviewed one do not want the same warning window.
 */
export function reviewBucket(
  nextReviewDate: Date | null | undefined,
  reminderDays = 15,
  now: Date = new Date(),
): ReviewBucket {
  if (!nextReviewDate) return "none";
  const days = daysBetween(today(now), nextReviewDate);
  if (days < 0) return "overdue";
  if (days === 0) return "due_today";
  if (days <= Math.max(0, reminderDays)) return "due_soon";
  return "scheduled";
}

/** True for the buckets the dashboard counts as "needs attention". */
export function isReviewDue(bucket: ReviewBucket): boolean {
  return bucket === "overdue" || bucket === "due_today" || bucket === "due_soon";
}

/** "in 12 days" / "today" / "6 days overdue" — the table's Next Review cell. */
export function reviewDueLabel(
  nextReviewDate: Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!nextReviewDate) return "—";
  const days = daysBetween(today(now), nextReviewDate);
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  const overdue = Math.abs(days);
  return `${overdue} day${overdue === 1 ? "" : "s"} overdue`;
}

// ── Acknowledgement deadlines ───────────────────────────────────────────────

/**
 * Whether an acknowledgement assignment has blown its deadline. Derived, not
 * stored, for the same reason as the review buckets: an "overdue" flag written
 * by a job is wrong from the moment the job stops running.
 */
export function isAckOverdue(
  deadline: Date | null | undefined,
  acknowledgedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (acknowledgedAt) return false;
  if (!deadline) return false;
  return daysBetween(today(now), deadline) < 0;
}
