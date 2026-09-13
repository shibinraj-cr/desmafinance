/**
 * Zod schemas for every SOP write path.
 *
 * They live together rather than beside each route so the editor's payloads and
 * the server's expectations cannot drift apart, and so the validation rules
 * (which vocabularies are legal, how long a field may be) are readable in one
 * place. `withApiHandler` turns a ZodError into a 400 with the issue list, so
 * routes just `.parse()` and get correct error responses for free.
 */

import { z } from "zod";
import {
  ATTACHMENT_TYPES,
  CONFIDENTIALITY_LEVELS,
  EXCEPTION_PRIORITIES,
  KPI_STATUSES,
  REVIEW_FREQUENCIES,
  SLA_UNITS,
  TRIGGER_TYPES,
} from "./constants";
import { WORKFLOW_ACTIONS } from "./workflow";

/** Trim, then treat "" as absent — an emptied input means "clear this field". */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const requiredText = (max: number, min = 1) => z.string().trim().min(min).max(max);

/** "2026-09-13" → a UTC-midnight Date, matching the @db.Date columns. */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .transform((v) => {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!));
  });

export const nullableDate = dateString.nullable().optional();

const idList = z.array(z.string().trim().min(1)).max(500).default([]);

// ── SOP creation ────────────────────────────────────────────────────────────

export const CreateSopSchema = z.object({
  title: requiredText(200),
  departmentId: z.string().trim().min(1),
  categoryId: z.string().trim().min(1).nullable().optional(),
  processFunction: nullableText(200),
  /** Mandatory (§3) — an SOP with no accountable owner is not an SOP. */
  ownerEmployeeId: z.string().trim().min(1),
  supportingRoleIds: idList,
  confidentiality: z.enum(CONFIDENTIALITY_LEVELS).default("general"),
  reviewerId: z.string().trim().min(1).nullable().optional(),
  approverId: z.string().trim().min(1).nullable().optional(),
});
export type CreateSopInput = z.infer<typeof CreateSopSchema>;

// ── Version content ─────────────────────────────────────────────────────────

/**
 * A partial edit of a draft version. Every field is optional so the editor can
 * autosave one section without resending the rest; `.strict()` rejects unknown
 * keys so a typo'd field name fails loudly instead of silently doing nothing.
 */
export const UpdateVersionSchema = z
  .object({
    title: requiredText(200).optional(),
    departmentId: z.string().trim().min(1).nullable().optional(),
    categoryId: z.string().trim().min(1).nullable().optional(),
    processFunction: nullableText(200),
    ownerEmployeeId: z.string().trim().min(1).optional(),
    supportingRoleIds: idList.optional(),
    confidentiality: z.enum(CONFIDENTIALITY_LEVELS).optional(),
    reviewerId: z.string().trim().min(1).nullable().optional(),
    approverId: z.string().trim().min(1).nullable().optional(),

    purpose: nullableText(20_000),
    triggerDescription: nullableText(5_000),
    triggerType: z.enum(TRIGGER_TYPES).nullable().optional(),
    triggerSource: nullableText(200),
    triggerCondition: nullableText(1_000),

    qualityStandard: nullableText(10_000),

    reviewFrequency: z.enum(REVIEW_FREQUENCIES).nullable().optional(),
    reviewIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
    lastReviewDate: nullableDate,
    nextReviewDate: nullableDate,
    reviewOwnerEmployeeId: z.string().trim().min(1).nullable().optional(),
    reviewReminderDays: z.number().int().min(0).max(365).optional(),

    changeSummary: nullableText(1_000),
  })
  .strict();
export type UpdateVersionInput = z.infer<typeof UpdateVersionSchema>;

// ── Steps ───────────────────────────────────────────────────────────────────

const ChecklistItemSchema = z.object({
  text: requiredText(500),
  isMandatory: z.boolean().default(true),
});

export const StepSchema = z.object({
  title: requiredText(200),
  instruction: nullableText(20_000),
  responsibleRoleId: z.string().trim().min(1).nullable().optional(),
  responsibleRoleName: nullableText(120),
  responsibleDepartmentId: z.string().trim().min(1).nullable().optional(),
  assignedEmployeeId: z.string().trim().min(1).nullable().optional(),
  slaValue: z.number().int().min(0).max(100_000).nullable().optional(),
  slaUnit: z.enum(SLA_UNITS).nullable().optional(),
  requiredInput: nullableText(2_000),
  expectedOutput: nullableText(2_000),
  evidence: nullableText(2_000),
  supportingDocument: nullableText(500),
  templateRef: nullableText(500),
  linkUrl: nullableText(2_000),
  notes: nullableText(2_000),
  /** The whole checklist, replaced wholesale — see the checklist route. */
  checklist: z.array(ChecklistItemSchema).max(100).optional(),
});
export type StepInput = z.infer<typeof StepSchema>;

export const ReorderSchema = z.object({ orderedIds: z.array(z.string().min(1)).min(1).max(500) });

// ── Quality criteria ────────────────────────────────────────────────────────

export const QualityCriterionSchema = z.object({
  criterion: requiredText(500),
  target: nullableText(200),
  isMandatory: z.boolean().default(true),
});

// ── Exceptions ──────────────────────────────────────────────────────────────

export const ExceptionSchema = z.object({
  issue: requiredText(500),
  condition: nullableText(1_000),
  requiredAction: nullableText(2_000),
  escalateToRoleId: z.string().trim().min(1).nullable().optional(),
  escalateToRoleName: nullableText(120),
  escalateToEmployeeId: z.string().trim().min(1).nullable().optional(),
  escalationSla: z.number().int().min(0).max(100_000).nullable().optional(),
  escalationUnit: z.enum(SLA_UNITS).nullable().optional(),
  priority: z.enum(EXCEPTION_PRIORITIES).default("medium"),
  notifyProcessOwner: z.boolean().default(false),
  notifyDepartmentHead: z.boolean().default(false),
});

// ── KPIs ────────────────────────────────────────────────────────────────────

export const KpiSchema = z.object({
  name: requiredText(200),
  description: nullableText(2_000),
  target: nullableText(120),
  unit: nullableText(60),
  measurementMethod: nullableText(1_000),
  dataSource: nullableText(500),
  reviewFrequency: z.enum(REVIEW_FREQUENCIES).nullable().optional(),
  kpiOwnerEmployeeId: z.string().trim().min(1).nullable().optional(),
});

export const KpiReviewSchema = z
  .object({
    periodStart: dateString,
    periodEnd: dateString,
    actual: requiredText(120),
    status: z.enum(KPI_STATUSES),
    notes: nullableText(2_000),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "The period end cannot be before the period start.",
    path: ["periodEnd"],
  });

// ── Attachments ─────────────────────────────────────────────────────────────

export const AttachmentLinkSchema = z
  .object({
    title: requiredText(200),
    docType: z.enum(ATTACHMENT_TYPES).default("link"),
    linkUrl: z.string().trim().url().max(2_000),
    docVersion: nullableText(60),
  })
  .strict();

// ── Workflow ────────────────────────────────────────────────────────────────

export const WorkflowSchema = z.object({
  action: z.enum(WORKFLOW_ACTIONS),
  decision: z.enum(["approve", "request_changes"]).optional(),
  comments: nullableText(4_000),
});

export const PublishSchema = z.object({
  effectiveDate: dateString,
  nextReviewDate: nullableDate,
  applicableDepartmentIds: idList,
  applicableRoleIds: idList,
  applicableEmployeeIds: idList,
  requiresAcknowledgement: z.boolean().default(false),
  acknowledgementDeadline: nullableDate,
  publishNotes: nullableText(4_000),
});

export const RevisionSchema = z.object({
  bump: z.enum(["minor", "major"]).default("minor"),
  changeSummary: nullableText(1_000),
});

export const ArchiveSchema = z.object({
  reason: requiredText(1_000),
  replacementSopId: z.string().trim().min(1).nullable().optional(),
  archiveDate: nullableDate,
});

// ── Categories ──────────────────────────────────────────────────────────────

export const CategorySchema = z.object({
  name: requiredText(120),
  description: nullableText(500),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const CategoryPatchSchema = CategorySchema.partial();

// ── Acknowledgement ─────────────────────────────────────────────────────────

export const AcknowledgeSchema = z.object({
  versionId: z.string().trim().min(1),
  /** "view" records that they opened it; "acknowledge" is the confirmation. */
  action: z.enum(["view", "acknowledge"]),
});
