/**
 * Lead quality — the consultant's verdict on the enquiry itself: was this a
 * real, relevant lead at all?
 *
 * It is the fourth label on a lead and answers a different question from the
 * other three. Stage = what happens next in the pipeline; Status = where the
 * conversation stands; Temperature = how likely they are to enrol soon. All
 * three move. Quality is judged once, by the BDE who worked the lead, and is
 * read back by source and campaign (Executive → Sales Analysis → Lead Quality)
 * so marketing can see which channels send genuine candidates and which send
 * junk. The rating is always SAID by the consultant, never inferred.
 *
 * The rule:
 *   - every lead that enters the system has `qualityDueAt` = inserted + 5 days
 *     (a database default; null on leads from before the rule and on
 *     re-enrollment leads, which are never mandatory);
 *   - once that passes, an unrated lead is OVERDUE for its assigned BDE: the
 *     lead page asks first, stage changes and task completions on it are
 *     refused, and a reminder pops up every {@link QUALITY_REMIND_EVERY_MINUTES};
 *   - closing a lead (a won / lost stage, Enroll included) asks for the rating
 *     in the same step, even before day 5 — by then the BDE knows.
 * Both gates bind only the lead's own BDE. Admins and supervisors acting on
 * someone else's lead can rate it but are never blocked. Unassigned leads and
 * leads in the Duplicate stage are never due.
 *
 * Pure (no prisma) so the client components share the exact rules; the
 * queries and the write path live in crm-lead-quality-data.ts.
 */

export const LEAD_QUALITY_RATINGS = ["good", "average", "poor", "junk"] as const;
export type LeadQualityRating = (typeof LEAD_QUALITY_RATINGS)[number];

/**
 * Colours form a diverging blue ↔ red ramp, two steps per arm (validated with
 * the dataviz ordinal checks): the scale has a good end and a bad end, and the
 * colour has to show which side a lead is on and how far. `ink` is the text
 * colour ON a filled chip — the light steps are too pale for white text.
 */
export const LEAD_QUALITIES: { value: LeadQualityRating; label: string; color: string; ink: string; hint: string }[] = [
  { value: "good", label: "Good", color: "#1c5cab", ink: "#ffffff", hint: "Genuine, eligible and interested" },
  { value: "average", label: "Average", color: "#86b6ef", ink: "#0d2b52", hint: "Genuine, but unsure or a weak fit" },
  { value: "poor", label: "Poor", color: "#f0a09c", ink: "#4a0f0e", hint: "A real person, but a poor fit" },
  { value: "junk", label: "Junk", color: "#b42f2d", ink: "#ffffff", hint: "Not a real enquiry" },
];

/** The neutral for "no verdict" (every unrated pile) in charts. */
export const QUALITY_UNRATED_COLOR = "#a8a7a2";

/**
 * Days a consultant has to rate a lead. Mirrors the `Lead.qualityDueAt` database
 * default (insert + 5 days) and is re-applied from the assignment moment by
 * {@link qualityDueAtOnAssign}.
 */
export const QUALITY_DUE_AFTER_DAYS = 5;

/** The reminder pop-up re-opens this often while any rating is overdue. */
export const QUALITY_REMIND_EVERY_MINUTES = 30;

/** Rows returned to the reminder pop-up (oldest due first); the total is always exact. */
export const QUALITY_REMINDER_LIST_LIMIT = 25;

/** Optional note on a rating — a remark, not a paragraph. */
export const QUALITY_NOTE_MAX = 200;

/** The error code the API answers with when a rating has to come first. */
export const QUALITY_REQUIRED_CODE = "quality_required";

/** Stage code exempt from the rule: a system-flagged duplicate is not a lead to judge. */
const DUPLICATE_STAGE_CODE = "duplicate";

export function normalizeQuality(v: string | null | undefined): LeadQualityRating | null {
  const c = v?.trim().toLowerCase();
  return (LEAD_QUALITY_RATINGS as readonly string[]).includes(c ?? "") ? (c as LeadQualityRating) : null;
}

export function leadQualityMeta(v: string | null | undefined) {
  return LEAD_QUALITIES.find((q) => q.value === v) ?? null;
}

/** Poor and Junk must say why, or the report can't tell a channel's wrong numbers from its ineligible candidates. */
export function qualityNeedsReason(rating: string | null | undefined): boolean {
  return rating === "poor" || rating === "junk";
}

export type QualitySubject = {
  qualityRating: string | null;
  qualityDueAt: Date | string | null;
  assignedToId: string | null;
  /** Current stage code. */
  statusCode: string;
};

const time = (d: Date | string) => (typeof d === "string" ? Date.parse(d) : d.getTime());

/** Whether this lead is in scope at all (ignoring the clock): tracked, unrated, owned, not a duplicate. */
export function qualityPending(lead: QualitySubject): boolean {
  return (
    lead.qualityDueAt != null &&
    !normalizeQuality(lead.qualityRating) &&
    lead.assignedToId !== null &&
    lead.statusCode !== DUPLICATE_STAGE_CODE
  );
}

/** Pending and past its due date. */
export function isQualityOverdue(lead: QualitySubject, now: Date): boolean {
  return qualityPending(lead) && time(lead.qualityDueAt!) <= now.getTime();
}

/**
 * The rating's due date after an (re)assignment, or undefined to leave it as is.
 *
 * The five days are the consultant's time to judge the lead, so they run from
 * when THIS consultant got it — not from when the row was inserted. Without
 * this, a lead assigned on day 6 (or revived to a different BDE months later)
 * reached its new owner already overdue, with stage changes and task ticks
 * blocked before they had made a single call. Never moves the date earlier,
 * and leaves alone leads outside the rule (`qualityDueAt` null) or already rated.
 */
export function qualityDueAtOnAssign(
  lead: { qualityDueAt: Date | null; qualityRating: string | null },
  now: Date,
): Date | undefined {
  if (lead.qualityDueAt == null || normalizeQuality(lead.qualityRating)) return undefined;
  const fresh = new Date(now.getTime() + QUALITY_DUE_AFTER_DAYS * 86_400_000);
  return fresh.getTime() > lead.qualityDueAt.getTime() ? fresh : undefined;
}

export type QualityGate = "overdue" | "closing";

/**
 * Must the rating come first? Asked before a stage change (pass `nextStage`)
 * or a task completion (omit it).
 *
 * Binds only the lead's own BDE: a supervisor closing someone else's lead
 * hasn't worked it and can't judge it. "closing" applies to any won / lost
 * stage except Duplicate, so marking a lead Not Interested on day 2 still
 * collects the rating, while the system's duplicate flag never asks.
 */
export function qualityGate(
  lead: QualitySubject,
  opts: { actorId: string; now: Date; nextStage?: { code: string; kind: string } | null },
): QualityGate | null {
  if (opts.actorId !== lead.assignedToId) return null;
  if (!qualityPending(lead)) return null;
  if (isQualityOverdue(lead, opts.now)) return "overdue";
  const next = opts.nextStage;
  if (next && next.code !== DUPLICATE_STAGE_CODE && (next.kind === "won" || next.kind === "lost")) return "closing";
  return null;
}

export const QUALITY_GATE_MESSAGE: Record<QualityGate, string> = {
  overdue: `This lead entered the system over ${QUALITY_DUE_AFTER_DAYS} days ago and still has no quality rating. Rate its quality first, then carry on.`,
  closing: "Rate this lead's quality before you close it. You know by now whether it was a genuine enquiry.",
};

/** Days until due (negative once overdue), rounded towards "sooner". Null when not tracked. */
export function daysUntilQualityDue(dueAt: Date | string | null, now: Date): number | null {
  if (dueAt == null) return null;
  return Math.floor((time(dueAt) - now.getTime()) / 86_400_000);
}

/**
 * One bucket per lead for the report and the leads-list filter. Rated leads
 * report their rating; unrated ones split by why they're unrated, because "not
 * rated" mixes the BDE's backlog with leads that were never meant to be.
 */
export const QUALITY_UNRATED_BUCKETS = [
  { value: "overdue", label: "Not rated (overdue)" },
  { value: "pending", label: "Not rated (not yet due)" },
  { value: "exempt", label: "Not rated (not required)" },
] as const;
export type QualityBucket = LeadQualityRating | (typeof QUALITY_UNRATED_BUCKETS)[number]["value"];

/** Display order for the report: the four ratings, then the unrated piles. */
export const QUALITY_BUCKET_ORDER: QualityBucket[] = [
  ...LEAD_QUALITY_RATINGS,
  ...QUALITY_UNRATED_BUCKETS.map((b) => b.value),
];

export function qualityBucketLabel(b: QualityBucket): string {
  return leadQualityMeta(b)?.label ?? QUALITY_UNRATED_BUCKETS.find((u) => u.value === b)?.label ?? b;
}

export function qualityBucket(lead: QualitySubject, now: Date): QualityBucket {
  const rating = normalizeQuality(lead.qualityRating);
  if (rating) return rating;
  if (!qualityPending(lead)) return "exempt";
  return isQualityOverdue(lead, now) ? "overdue" : "pending";
}

/**
 * Whether the reminder pop-up should open now: something is overdue and it
 * hasn't been shown (or put away) within the reminder interval.
 */
export function shouldRemindQuality(opts: { now: number; lastShownAt: number | null; overdueCount: number }): boolean {
  if (opts.overdueCount <= 0) return false;
  if (opts.lastShownAt == null) return true;
  return opts.now - opts.lastShownAt >= QUALITY_REMIND_EVERY_MINUTES * 60_000;
}

export type QualityReasonOpt = { id: string; label: string };

export type QualityReminderLead = {
  id: string;
  candidateName: string;
  source: string | null;
  campaign: string | null;
  /** ISO — when the rating fell due. */
  dueAt: string;
};

export type QualityReminderSnapshot = {
  total: number;
  leads: QualityReminderLead[];
  reasons: QualityReasonOpt[];
};
