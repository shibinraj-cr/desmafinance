/**
 * SOP Management — the module's controlled vocabularies.
 *
 * Every status / unit / level the module recognises lives here as a `const`
 * tuple plus a label map, rather than as a Prisma enum. Same reasoning the rest
 * of the app uses for CRM lead statuses and Operations task statuses: adding a
 * value must not need a migration, and the DB column stays a plain string that
 * old rows can never violate.
 *
 * ── Why this file matters for the automation phase ──────────────────────────
 * The brief (§24) asks that an SOP step later become an executable task without
 * redesigning the module. What makes that possible is not a flag — it is that
 * responsibility, SLA and trigger are STRUCTURED here and stored as typed
 * columns on SopStep / SopVersion, so a future engine can read
 * (responsibleRoleId, slaMinutes, triggerType) off a row and mint an OpsTask
 * from it. Nothing in this file executes anything today.
 */

// ── Workflow status ─────────────────────────────────────────────────────────

export const SOP_STATUSES = [
  "draft",
  "review_requested",
  "changes_requested",
  "approval_pending",
  "approved",
  "published",
  "revision_required",
  "archived",
] as const;
export type SopStatus = (typeof SOP_STATUSES)[number];

export const SOP_STATUS_LABELS: Record<SopStatus, string> = {
  draft: "Draft",
  review_requested: "Review Requested",
  changes_requested: "Changes Requested",
  approval_pending: "Approval Pending",
  approved: "Approved",
  published: "Published",
  revision_required: "Revision Required",
  archived: "Archived",
};

/**
 * Status pill tone. Uses the app's existing surface/primary/error tokens only —
 * no new colours — so an SOP badge sits beside a CRM or HR badge unremarkably.
 */
export const SOP_STATUS_CLASSES: Record<SopStatus, string> = {
  draft: "bg-surface-container-high text-on-surface-variant",
  review_requested: "bg-primary-fixed text-on-primary",
  changes_requested: "bg-error-container text-on-error-container",
  approval_pending: "bg-primary-fixed-dim text-on-primary",
  approved: "bg-primary text-on-primary",
  published: "bg-accent text-on-primary",
  revision_required: "bg-error-container text-on-error-container",
  archived: "bg-surface-container text-on-surface-variant",
};

export function sopStatusLabel(status: string): string {
  return SOP_STATUS_LABELS[status as SopStatus] ?? status;
}
export function sopStatusClass(status: string): string {
  return SOP_STATUS_CLASSES[status as SopStatus] ?? SOP_STATUS_CLASSES.draft;
}
export function isSopStatus(v: string): v is SopStatus {
  return (SOP_STATUSES as readonly string[]).includes(v);
}

/** Statuses whose content is still editable. Everything else is history. */
export const EDITABLE_STATUSES: SopStatus[] = ["draft", "changes_requested", "revision_required"];

// ── Confidentiality ─────────────────────────────────────────────────────────

export const CONFIDENTIALITY_LEVELS = ["general", "department", "management", "restricted"] as const;
export type Confidentiality = (typeof CONFIDENTIALITY_LEVELS)[number];

export const CONFIDENTIALITY_LABELS: Record<Confidentiality, string> = {
  general: "General",
  department: "Department Only",
  management: "Management",
  restricted: "Restricted",
};

/** What each level means, shown as helper text under the picker. */
export const CONFIDENTIALITY_HINTS: Record<Confidentiality, string> = {
  general: "Any signed-in employee can read it.",
  department: "Only the SOP's department, plus anyone it is published to.",
  management: "Approvers, department heads and SOP admins.",
  restricted: "Only the people named on the SOP, plus SOP admins.",
};

export function isConfidentiality(v: string): v is Confidentiality {
  return (CONFIDENTIALITY_LEVELS as readonly string[]).includes(v);
}
export function confidentialityLabel(v: string): string {
  return CONFIDENTIALITY_LABELS[v as Confidentiality] ?? v;
}

// ── Trigger (structured, for the automation phase) ──────────────────────────

export const TRIGGER_TYPES = [
  "manual",
  "status_change",
  "task_completion",
  "datetime",
  "new_lead",
  "new_candidate",
  "payment_received",
  "document_uploaded",
  "application_stage_change",
  "employee_action",
  "api_webhook",
  "other",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const TRIGGER_TYPE_LABELS: Record<TriggerType, string> = {
  manual: "Manual",
  status_change: "Status Change",
  task_completion: "Task Completion",
  datetime: "Date / Time",
  new_lead: "New Lead",
  new_candidate: "New Candidate",
  payment_received: "Payment Received",
  document_uploaded: "Document Uploaded",
  application_stage_change: "Application Stage Change",
  employee_action: "Employee Action",
  api_webhook: "API / Webhook",
  other: "Other",
};

export function triggerTypeLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return TRIGGER_TYPE_LABELS[v as TriggerType] ?? v;
}

// ── SLA ─────────────────────────────────────────────────────────────────────

export const SLA_UNITS = ["minutes", "hours", "days"] as const;
export type SlaUnit = (typeof SLA_UNITS)[number];

export const SLA_UNIT_LABELS: Record<SlaUnit, string> = {
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
};

const SLA_UNIT_MINUTES: Record<SlaUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 60 * 24,
};

export function isSlaUnit(v: string): v is SlaUnit {
  return (SLA_UNITS as readonly string[]).includes(v);
}

/**
 * The comparable minute count for an SLA written as value + unit.
 *
 * Stored alongside the authored value/unit rather than replacing them: an SOP
 * that says "1 day" must read back as "1 day", not "1440 minutes", but SLA
 * breach maths needs one comparable scale.
 */
export function slaToMinutes(value: number | null | undefined, unit: string | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  if (!unit || !isSlaUnit(unit)) return null;
  return Math.round(value * SLA_UNIT_MINUTES[unit]);
}

/** "4 hours", "1 day", "—". */
export function formatSla(value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null || !unit || !isSlaUnit(unit)) return "—";
  const label = value === 1 ? unit.replace(/s$/, "") : unit;
  return `${value} ${label}`;
}

// ── Exception priority ──────────────────────────────────────────────────────

export const EXCEPTION_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type ExceptionPriority = (typeof EXCEPTION_PRIORITIES)[number];

export const EXCEPTION_PRIORITY_LABELS: Record<ExceptionPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const EXCEPTION_PRIORITY_CLASSES: Record<ExceptionPriority, string> = {
  low: "bg-surface-container-high text-on-surface-variant",
  medium: "bg-primary-fixed text-on-primary",
  high: "bg-primary-container text-on-primary-container",
  critical: "bg-error text-on-primary",
};

export function isExceptionPriority(v: string): v is ExceptionPriority {
  return (EXCEPTION_PRIORITIES as readonly string[]).includes(v);
}

// ── Review frequency ────────────────────────────────────────────────────────

export const REVIEW_FREQUENCIES = [
  "weekly",
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
  "custom",
] as const;
export type ReviewFrequency = (typeof REVIEW_FREQUENCIES)[number];

export const REVIEW_FREQUENCY_LABELS: Record<ReviewFrequency, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-Yearly",
  yearly: "Yearly",
  custom: "Custom",
};

export function isReviewFrequency(v: string): v is ReviewFrequency {
  return (REVIEW_FREQUENCIES as readonly string[]).includes(v);
}
export function reviewFrequencyLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return REVIEW_FREQUENCY_LABELS[v as ReviewFrequency] ?? v;
}

/** Suggested reminder-day options; any positive integer is accepted. */
export const REVIEW_REMINDER_OPTIONS = [7, 15, 30] as const;

// ── KPI status ──────────────────────────────────────────────────────────────

export const KPI_STATUSES = ["on_target", "needs_attention", "below_target"] as const;
export type KpiStatus = (typeof KPI_STATUSES)[number];

export const KPI_STATUS_LABELS: Record<KpiStatus, string> = {
  on_target: "On Target",
  needs_attention: "Needs Attention",
  below_target: "Below Target",
};

export const KPI_STATUS_CLASSES: Record<KpiStatus, string> = {
  on_target: "bg-accent text-on-primary",
  needs_attention: "bg-primary-fixed text-on-primary",
  below_target: "bg-error-container text-on-error-container",
};

export function isKpiStatus(v: string): v is KpiStatus {
  return (KPI_STATUSES as readonly string[]).includes(v);
}

// ── Acknowledgement ─────────────────────────────────────────────────────────

export const ACK_STATES = ["not_viewed", "viewed", "acknowledged", "overdue"] as const;
export type AckState = (typeof ACK_STATES)[number];

export const ACK_STATE_LABELS: Record<AckState, string> = {
  not_viewed: "Not Viewed",
  viewed: "Viewed",
  acknowledged: "Acknowledged",
  overdue: "Overdue",
};

export const ACK_STATE_CLASSES: Record<AckState, string> = {
  not_viewed: "bg-surface-container-high text-on-surface-variant",
  viewed: "bg-primary-fixed text-on-primary",
  acknowledged: "bg-accent text-on-primary",
  overdue: "bg-error-container text-on-error-container",
};

// ── Attachments ─────────────────────────────────────────────────────────────

export const ATTACHMENT_TYPES = [
  "form",
  "checklist",
  "template",
  "policy",
  "training_video",
  "drive",
  "link",
  "other",
] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export const ATTACHMENT_TYPE_LABELS: Record<AttachmentType, string> = {
  form: "Form",
  checklist: "Checklist",
  template: "Template",
  policy: "Policy",
  training_video: "Training Video",
  drive: "Drive Document",
  link: "External Link",
  other: "Other",
};

export function isAttachmentType(v: string): v is AttachmentType {
  return (ATTACHMENT_TYPES as readonly string[]).includes(v);
}

/**
 * Upload allow-list. Anything not on it is rejected server-side — the file
 * picker's `accept` attribute is a convenience, never the control.
 */
export const ALLOWED_ATTACHMENT_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/csv": "csv",
  "text/plain": "txt",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Audit ───────────────────────────────────────────────────────────────────

export const SOP_AUDIT_ACTIONS = [
  "SOP_CREATED",
  "DRAFT_EDITED",
  "REVIEWER_CHANGED",
  "APPROVER_CHANGED",
  "REVIEW_REQUESTED",
  "CHANGES_REQUESTED",
  "REVIEW_APPROVED",
  "SUBMITTED_FOR_APPROVAL",
  "APPROVED",
  "PUBLISHED",
  "ACKNOWLEDGED",
  "VIEWED",
  "REVISION_CREATED",
  "ARCHIVED",
  "UNARCHIVED",
  "DELETED",
  "KPI_UPDATED",
  "KPI_REVIEW_RECORDED",
  "STEP_ADDED",
  "STEP_UPDATED",
  "STEP_DELETED",
  "STEPS_REORDERED",
  "ATTACHMENT_ADDED",
  "ATTACHMENT_DELETED",
] as const;
export type SopAuditAction = (typeof SOP_AUDIT_ACTIONS)[number];

export const SOP_AUDIT_LABELS: Record<SopAuditAction, string> = {
  SOP_CREATED: "SOP created",
  DRAFT_EDITED: "Draft edited",
  REVIEWER_CHANGED: "Reviewer changed",
  APPROVER_CHANGED: "Approver changed",
  REVIEW_REQUESTED: "Review requested",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_APPROVED: "Review approved",
  SUBMITTED_FOR_APPROVAL: "Submitted for approval",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  ACKNOWLEDGED: "Acknowledged",
  VIEWED: "Viewed",
  REVISION_CREATED: "Revision created",
  ARCHIVED: "Archived",
  UNARCHIVED: "Restored from archive",
  DELETED: "Deleted",
  KPI_UPDATED: "KPI updated",
  KPI_REVIEW_RECORDED: "KPI review recorded",
  STEP_ADDED: "Step added",
  STEP_UPDATED: "Step updated",
  STEP_DELETED: "Step deleted",
  STEPS_REORDERED: "Steps reordered",
  ATTACHMENT_ADDED: "Attachment added",
  ATTACHMENT_DELETED: "Attachment deleted",
};

export function sopAuditLabel(action: string): string {
  return SOP_AUDIT_LABELS[action as SopAuditAction] ?? action;
}

// ── Notifications ───────────────────────────────────────────────────────────

export const SOP_NOTIFICATION_KINDS = [
  "review_assigned",
  "approval_assigned",
  "changes_requested",
  "sop_approved",
  "sop_published",
  "acknowledgement_required",
  "acknowledgement_overdue",
  "review_due",
  "review_overdue",
  "kpi_review_due",
  "critical_escalation",
] as const;
export type SopNotificationKind = (typeof SOP_NOTIFICATION_KINDS)[number];

// ── Department codes ────────────────────────────────────────────────────────

/**
 * Department name → SOP number prefix.
 *
 * Only the departments whose natural abbreviation is NOT the first three
 * letters need a row; everything else falls through to `deriveDeptCode`. The
 * code is snapshotted onto the Sop at creation (`Sop.deptCode`), so renaming a
 * department never renumbers SOPs that already exist.
 */
export const DEPT_CODE_OVERRIDES: Record<string, string> = {
  operations: "OPS",
  operation: "OPS",
  "human resources": "HR",
  hr: "HR",
  finance: "FIN",
  accounts: "FIN",
  "accounts & finance": "FIN",
  marketing: "MKT",
  "digital marketing": "MKT",
  sales: "SLS",
  "business development": "BD",
  administration: "ADM",
  admin: "ADM",
  it: "IT",
  "information technology": "IT",
  management: "MGT",
  documentation: "DOC",
  training: "TRN",
  quality: "QA",
  recruitment: "REC",
  hiring: "REC",
};

/** Fallback used when a department has no explicit prefix. */
export const DEFAULT_DEPT_CODE = "GEN";

/**
 * A stable, uppercase SOP prefix for a department name.
 *
 * Deterministic and pure so the seed, the API and the tests all agree. Two
 * departments may legitimately map to the same code — the sequence is per code,
 * and `Sop.sopNumber` is unique, so that is harmless.
 */
export function deriveDeptCode(departmentName: string | null | undefined): string {
  const raw = (departmentName ?? "").trim();
  if (!raw) return DEFAULT_DEPT_CODE;

  const override = DEPT_CODE_OVERRIDES[raw.toLowerCase()];
  if (override) return override;

  // Drop connective words so "Learning and Development" → "LD", not "LEA".
  const STOP = new Set(["and", "of", "the", "&", "for", "department", "dept", "team"]);
  const words = raw
    .split(/[\s/,&-]+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter((w) => w.length > 0 && !STOP.has(w.toLowerCase()));

  if (words.length === 0) return DEFAULT_DEPT_CODE;
  // Multi-word names become initials (max 4); a single word becomes its first
  // three letters.
  const code =
    words.length > 1
      ? words.slice(0, 4).map((w) => w[0]!).join("")
      : words[0]!.slice(0, 3);
  return code.toUpperCase() || DEFAULT_DEPT_CODE;
}

/** "OPS" + 1 → "OPS-SOP-001". Sequences past 999 simply grow wider. */
export function formatSopNumber(deptCode: string, seq: number): string {
  return `${deptCode}-SOP-${String(seq).padStart(3, "0")}`;
}
