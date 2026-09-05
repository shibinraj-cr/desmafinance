/**
 * Hiring-module vocabularies and seeds.
 *
 * Everything a picker offers or a new job is seeded with lives here, so the UI,
 * the API validators and the seed script can never drift apart.
 *
 * Locale is India throughout: comp is expressed in LAKH PER YEAR (never rupees),
 * timestamps are stored UTC and rendered IST, and the working week is Mon–Sat.
 */

export const HIRING_TIMEZONE = "Asia/Kolkata";

/** Stage `kind` — analytics groups by this, NEVER by the stage name string. */
export const STAGE_KINDS = ["open", "won", "lost", "hold"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

/**
 * Every new job is seeded with these. Names are editable and stages are
 * reorderable per job afterwards; `kind` + `position` are what survive a rename.
 */
export const DEFAULT_STAGES: { name: string; kind: StageKind; slaDays: number | null }[] = [
  { name: "Applied", kind: "open", slaDays: 3 },
  { name: "Screening", kind: "open", slaDays: 3 },
  { name: "Shortlisted", kind: "open", slaDays: 2 },
  { name: "Interview", kind: "open", slaDays: 5 },
  { name: "Offer", kind: "open", slaDays: 5 },
  { name: "Hired", kind: "won", slaDays: null },
  { name: "Rejected", kind: "lost", slaDays: null },
  { name: "On hold", kind: "hold", slaDays: null },
];

/** Weights must total 100 — publish is blocked otherwise. */
export const DEFAULT_RUBRIC: { criterion: string; description: string; weight: number }[] = [
  { criterion: "Skills match", description: "Overlap with the must-haves", weight: 40 },
  { criterion: "Experience depth", description: "Years + scope of past roles", weight: 25 },
  { criterion: "Communication", description: "Written + recorded clarity", weight: 20 },
  { criterion: "Culture signal", description: "Bias-to-action, evidence-first", weight: 15 },
];

/** The two screening questions every new job ships with (§3.1 step 3). */
export const DEFAULT_SCREENING_QUESTIONS: {
  prompt: string;
  helperText: string | null;
  answerType: AnswerType;
  required: boolean;
}[] = [
  {
    prompt: "What in your experience lines up most closely with this role?",
    helperText: "A few sentences is plenty.",
    answerType: "detailed_text",
    required: true,
  },
  {
    prompt: "Why this role, and why now?",
    helperText: null,
    answerType: "detailed_text",
    required: true,
  },
];

export const WORK_TYPES = ["onsite", "hybrid", "remote", "not_stated"] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
  not_stated: "Not stated",
};

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

export const SENIORITIES = ["intern", "junior", "mid", "senior", "lead", "head"] as const;
export type Seniority = (typeof SENIORITIES)[number];
export const SENIORITY_LABELS: Record<Seniority, string> = {
  intern: "Intern",
  junior: "Junior",
  mid: "Mid",
  senior: "Senior",
  lead: "Lead",
  head: "Head",
};

export const JOB_STATUSES = ["draft", "pending_approval", "live", "paused", "closed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  live: "Live",
  paused: "Paused",
  closed: "Closed",
};

/** "required" means a résumé OR a portfolio link — one of the two. */
export const RESUME_MODES = ["required", "optional", "skip"] as const;
export type ResumeMode = (typeof RESUME_MODES)[number];

export const ANSWER_TYPES = [
  "short_text",
  "detailed_text",
  "single_select",
  "multi_select",
  "number",
  "file",
  "yes_no",
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];
export const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  short_text: "Short text",
  detailed_text: "Detailed text",
  single_select: "Single select",
  multi_select: "Multi select",
  number: "Number",
  file: "File upload",
  yes_no: "Yes / No",
};

export const APPLICATION_STATUSES = ["active", "rejected", "on_hold", "withdrawn", "hired"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const CANDIDATE_SOURCES = [
  "careers_page",
  "referral",
  "partner",
  "manual",
  "csv_import",
  "talent_pool",
  "whatsapp",
  "walk_in",
] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];
export const CANDIDATE_SOURCE_LABELS: Record<CandidateSource, string> = {
  careers_page: "Careers page",
  referral: "Referral",
  partner: "Sourcing partner",
  manual: "Added manually",
  csv_import: "CSV import",
  talent_pool: "Talent pool",
  whatsapp: "WhatsApp",
  walk_in: "Walk-in",
};

export const EVENT_TYPES = [
  "created",
  "stage_moved",
  "scored",
  "note",
  "email_sent",
  "whatsapp_sent",
  "whatsapp_received",
  "interview_scheduled",
  "scorecard_submitted",
  "offer_sent",
  "offer_signed",
  "rejected",
  "reopened",
  "automation_fired",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const INTERVIEW_KINDS = [
  "phone_screen",
  "async_video",
  "technical",
  "panel",
  "manager",
  "final",
] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];
export const INTERVIEW_KIND_LABELS: Record<InterviewKind, string> = {
  phone_screen: "Phone screen",
  async_video: "Async video",
  technical: "Technical",
  panel: "Panel",
  manager: "Manager",
  final: "Final",
};

export const SCORECARD_VERDICTS = ["strong_no", "no", "yes", "strong_yes"] as const;
export type ScorecardVerdict = (typeof SCORECARD_VERDICTS)[number];
export const SCORECARD_VERDICT_LABELS: Record<ScorecardVerdict, string> = {
  strong_no: "Strong no",
  no: "No",
  yes: "Yes",
  strong_yes: "Strong yes",
};

export const OFFER_STATUSES = [
  "draft",
  "pending_approval",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const TALENT_POOL_STATES = ["new", "nurturing", "re_engage", "placed", "cold"] as const;
export type TalentPoolState = (typeof TALENT_POOL_STATES)[number];
export const TALENT_POOL_STATE_LABELS: Record<TalentPoolState, string> = {
  new: "New",
  nurturing: "Nurturing",
  re_engage: "Re-engage",
  placed: "Placed",
  cold: "Cold",
};

export const PARTNER_STATUSES = ["invited", "trial", "active", "paused"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

/** A live req open longer than this is "aging" and surfaces in its own tab. */
export const JOB_AGING_DAYS = 21;

/**
 * "Shortlisted but silent" threshold (§3.4) — more than this many WORKING days
 * with no outbound contact. Sundays are excluded when counting; the company
 * works Mon–Sat.
 */
export const SILENT_SHORTLIST_WORKING_DAYS = 2;

/** Rows the marker tags so every seeded record can be removed in one command. */
export const SEED_TAG = "SEED_DEMO";
