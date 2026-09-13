/**
 * The editor's wire format.
 *
 * Prisma rows carry `Date` and `Decimal`, neither of which survives the
 * server→client boundary as itself. Rather than let each client component
 * discover that separately, everything the editor and the reading view need is
 * serialised here, once, into plain JSON — and the client's prop types are
 * derived from these functions, so a column added to the schema shows up as a
 * type error at the point it needs handling.
 */

import type { Prisma } from "@prisma/client";
import { versionDetailInclude, sopDetailInclude } from "./queries";
import { acknowledgementState } from "./acknowledge";
import type { AckState } from "./constants";

type VersionRow = Prisma.SopVersionGetPayload<{ include: typeof versionDetailInclude }>;
type SopRowFull = Prisma.SopGetPayload<{ include: typeof sopDetailInclude }>;

const day = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const stamp = (d: Date | null | undefined): string | null => d?.toISOString() ?? null;

export type StepDTO = {
  id: string;
  seq: number;
  title: string;
  instruction: string | null;
  responsibleRoleId: string | null;
  responsibleRoleName: string | null;
  responsibleRole: string | null;
  responsibleDepartmentId: string | null;
  responsibleDepartment: string | null;
  assignedEmployeeId: string | null;
  assignedEmployee: string | null;
  slaValue: number | null;
  slaUnit: string | null;
  requiredInput: string | null;
  expectedOutput: string | null;
  evidence: string | null;
  supportingDocument: string | null;
  templateRef: string | null;
  linkUrl: string | null;
  notes: string | null;
  checklist: { id: string; seq: number; text: string; isMandatory: boolean }[];
};

export type QualityDTO = {
  id: string;
  seq: number;
  criterion: string;
  target: string | null;
  isMandatory: boolean;
};

export type ExceptionDTO = {
  id: string;
  seq: number;
  issue: string;
  condition: string | null;
  requiredAction: string | null;
  escalateToRoleId: string | null;
  escalateToRole: string | null;
  escalateToRoleName: string | null;
  escalateToEmployeeId: string | null;
  escalateToEmployee: string | null;
  escalationSla: number | null;
  escalationUnit: string | null;
  priority: string;
  notifyProcessOwner: boolean;
  notifyDepartmentHead: boolean;
};

export type KpiDTO = {
  id: string;
  seq: number;
  name: string;
  description: string | null;
  target: string | null;
  unit: string | null;
  measurementMethod: string | null;
  dataSource: string | null;
  reviewFrequency: string | null;
  kpiOwnerEmployeeId: string | null;
  kpiOwner: string | null;
  latestActual: string | null;
  latestStatus: string | null;
  latestReviewedAt: string | null;
  reviews: {
    id: string;
    periodStart: string | null;
    periodEnd: string | null;
    actual: string;
    status: string;
    notes: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
  }[];
};

export type AttachmentDTO = {
  id: string;
  title: string;
  docType: string;
  fileUrl: string | null;
  linkUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  docVersion: string | null;
  uploadedBy: string | null;
  createdAt: string;
};

export type ActionDTO = {
  id: string;
  stage: string;
  decision: string;
  comments: string | null;
  actor: string | null;
  actedAt: string;
};

export type VersionDTO = ReturnType<typeof serializeVersion>;
export type SopHeaderDTO = ReturnType<typeof serializeSopHeader>;

export function serializeVersion(v: VersionRow) {
  return {
    id: v.id,
    sopId: v.sopId,
    versionLabel: v.versionLabel,
    major: v.major,
    minor: v.minor,
    status: v.status,
    isLocked: v.isLocked,

    title: v.title,
    departmentId: v.departmentId,
    department: v.department?.name ?? null,
    categoryId: v.categoryId,
    category: v.category?.name ?? null,
    processFunction: v.processFunction,
    ownerEmployeeId: v.ownerEmployeeId,
    owner: v.ownerEmployee?.name ?? null,
    supportingRoleIds: v.supportingRoleIds,
    confidentiality: v.confidentiality,
    reviewerId: v.reviewerId,
    reviewer: v.reviewer?.username ?? null,
    approverId: v.approverId,
    approver: v.approver?.username ?? null,

    purpose: v.purpose,
    triggerDescription: v.triggerDescription,
    triggerType: v.triggerType,
    triggerSource: v.triggerSource,
    triggerCondition: v.triggerCondition,
    qualityStandard: v.qualityStandard,

    reviewFrequency: v.reviewFrequency,
    reviewIntervalDays: v.reviewIntervalDays,
    lastReviewDate: day(v.lastReviewDate),
    nextReviewDate: day(v.nextReviewDate),
    reviewOwnerEmployeeId: v.reviewOwnerEmployeeId,
    reviewOwner: v.reviewOwnerEmployee?.name ?? null,
    reviewReminderDays: v.reviewReminderDays,

    effectiveDate: day(v.effectiveDate),
    applicableDepartmentIds: v.applicableDepartmentIds,
    applicableRoleIds: v.applicableRoleIds,
    applicableEmployeeIds: v.applicableEmployeeIds,
    requiresAcknowledgement: v.requiresAcknowledgement,
    acknowledgementDeadline: day(v.acknowledgementDeadline),
    publishNotes: v.publishNotes,
    changeSummary: v.changeSummary,

    createdBy: v.createdBy?.username ?? null,
    createdById: v.createdById,
    submittedForReviewAt: stamp(v.submittedForReviewAt),
    reviewedAt: stamp(v.reviewedAt),
    reviewedBy: v.reviewedBy?.username ?? null,
    submittedForApprovalAt: stamp(v.submittedForApprovalAt),
    approvedAt: stamp(v.approvedAt),
    approvedBy: v.approvedBy?.username ?? null,
    publishedAt: stamp(v.publishedAt),
    publishedBy: v.publishedBy?.username ?? null,
    previousVersionId: v.previousVersionId,

    steps: v.steps.map(
      (s): StepDTO => ({
        id: s.id,
        seq: s.seq,
        title: s.title,
        instruction: s.instruction,
        responsibleRoleId: s.responsibleRoleId,
        responsibleRoleName: s.responsibleRoleName,
        responsibleRole: s.responsibleRole?.name ?? s.responsibleRoleName ?? null,
        responsibleDepartmentId: s.responsibleDepartmentId,
        responsibleDepartment: s.responsibleDepartment?.name ?? null,
        assignedEmployeeId: s.assignedEmployeeId,
        assignedEmployee: s.assignedEmployee?.name ?? null,
        slaValue: s.slaValue,
        slaUnit: s.slaUnit,
        requiredInput: s.requiredInput,
        expectedOutput: s.expectedOutput,
        evidence: s.evidence,
        supportingDocument: s.supportingDocument,
        templateRef: s.templateRef,
        linkUrl: s.linkUrl,
        notes: s.notes,
        checklist: s.checklists.map((c) => ({
          id: c.id,
          seq: c.seq,
          text: c.text,
          isMandatory: c.isMandatory,
        })),
      }),
    ),

    qualityCriteria: v.qualityCriteria.map(
      (q): QualityDTO => ({
        id: q.id,
        seq: q.seq,
        criterion: q.criterion,
        target: q.target,
        isMandatory: q.isMandatory,
      }),
    ),

    exceptions: v.exceptions.map(
      (x): ExceptionDTO => ({
        id: x.id,
        seq: x.seq,
        issue: x.issue,
        condition: x.condition,
        requiredAction: x.requiredAction,
        escalateToRoleId: x.escalateToRoleId,
        escalateToRole: x.escalateToRole?.name ?? x.escalateToRoleName ?? null,
        escalateToRoleName: x.escalateToRoleName,
        escalateToEmployeeId: x.escalateToEmployeeId,
        escalateToEmployee: x.escalateToEmployee?.name ?? null,
        escalationSla: x.escalationSla,
        escalationUnit: x.escalationUnit,
        priority: x.priority,
        notifyProcessOwner: x.notifyProcessOwner,
        notifyDepartmentHead: x.notifyDepartmentHead,
      }),
    ),

    kpis: v.kpis.map(
      (k): KpiDTO => ({
        id: k.id,
        seq: k.seq,
        name: k.name,
        description: k.description,
        target: k.target,
        unit: k.unit,
        measurementMethod: k.measurementMethod,
        dataSource: k.dataSource,
        reviewFrequency: k.reviewFrequency,
        kpiOwnerEmployeeId: k.kpiOwnerEmployeeId,
        kpiOwner: k.kpiOwnerEmployee?.name ?? null,
        latestActual: k.latestActual,
        latestStatus: k.latestStatus,
        latestReviewedAt: stamp(k.latestReviewedAt),
        reviews: k.reviews.map((r) => ({
          id: r.id,
          periodStart: day(r.periodStart),
          periodEnd: day(r.periodEnd),
          actual: r.actual,
          status: r.status,
          notes: r.notes,
          reviewedBy: r.reviewedBy?.username ?? null,
          reviewedAt: stamp(r.reviewedAt),
        })),
      }),
    ),

    attachments: v.attachments.map(
      (a): AttachmentDTO => ({
        id: a.id,
        title: a.title,
        docType: a.docType,
        fileUrl: a.fileUrl,
        linkUrl: a.linkUrl,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        docVersion: a.docVersion,
        uploadedBy: a.uploadedBy?.username ?? null,
        createdAt: a.createdAt.toISOString(),
      }),
    ),

    actions: v.actions.map(
      (a): ActionDTO => ({
        id: a.id,
        stage: a.stage,
        decision: a.decision,
        comments: a.comments,
        actor: a.actor?.username ?? null,
        actedAt: a.actedAt.toISOString(),
      }),
    ),
  };
}

export function serializeSopHeader(s: SopRowFull) {
  return {
    id: s.id,
    sopNumber: s.sopNumber,
    title: s.title,
    status: s.status,
    departmentId: s.departmentId,
    department: s.department?.name ?? null,
    categoryId: s.categoryId,
    category: s.category?.name ?? null,
    processFunction: s.processFunction,
    ownerEmployeeId: s.ownerEmployeeId,
    owner: s.ownerEmployee?.name ?? null,
    ownerDesignation: s.ownerEmployee?.designation ?? null,
    confidentiality: s.confidentiality,
    effectiveDate: day(s.effectiveDate),
    nextReviewDate: day(s.nextReviewDate),
    requiresAcknowledgement: s.requiresAcknowledgement,
    viewCount: s.viewCount,
    currentVersionId: s.currentVersionId,
    draftVersionId: s.draftVersionId,
    createdBy: s.createdBy?.username ?? null,
    createdById: s.createdById,
    isArchived: s.isArchived,
    archivedAt: stamp(s.archivedAt),
    archivedBy: s.archivedBy?.username ?? null,
    archiveReason: s.archiveReason,
    replacement: s.replacementSop
      ? { id: s.replacementSop.id, sopNumber: s.replacementSop.sopNumber, title: s.replacementSop.title }
      : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** The signed-in viewer's own acknowledgement state on the version being read. */
export type MyAckDTO = {
  id: string;
  deadline: string | null;
  viewedAt: string | null;
  acknowledgedAt: string | null;
  state: AckState;
} | null;

export function serializeMyAck(
  row: { id: string; deadline: Date | null; viewedAt: Date | null; acknowledgedAt: Date | null } | null,
): MyAckDTO {
  if (!row) return null;
  return {
    id: row.id,
    deadline: day(row.deadline),
    viewedAt: stamp(row.viewedAt),
    acknowledgedAt: stamp(row.acknowledgedAt),
    state: acknowledgementState(row),
  };
}

/** Version-history rows, serialised for the history panel. */
export type VersionHistoryDTO = {
  id: string;
  versionLabel: string;
  status: string;
  isLocked: boolean;
  changeSummary: string | null;
  effectiveDate: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  previousVersionId: string | null;
  createdAt: string;
  createdBy: string | null;
  reviewedBy: string | null;
  approvedBy: string | null;
  publishedBy: string | null;
};

export function serializeHistory(
  rows: {
    id: string;
    versionLabel: string;
    status: string;
    isLocked: boolean;
    changeSummary: string | null;
    effectiveDate: Date | null;
    publishedAt: Date | null;
    archivedAt: Date | null;
    previousVersionId: string | null;
    createdAt: Date;
    createdBy: { username: string } | null;
    reviewedBy: { username: string } | null;
    approvedBy: { username: string } | null;
    publishedBy: { username: string } | null;
  }[],
): VersionHistoryDTO[] {
  return rows.map((r) => ({
    id: r.id,
    versionLabel: r.versionLabel,
    status: r.status,
    isLocked: r.isLocked,
    changeSummary: r.changeSummary,
    effectiveDate: day(r.effectiveDate),
    publishedAt: stamp(r.publishedAt),
    archivedAt: stamp(r.archivedAt),
    previousVersionId: r.previousVersionId,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy?.username ?? null,
    reviewedBy: r.reviewedBy?.username ?? null,
    approvedBy: r.approvedBy?.username ?? null,
    publishedBy: r.publishedBy?.username ?? null,
  }));
}

/** Audit rows, serialised for the audit panel. */
export type AuditDTO = {
  id: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  versionLabel: string | null;
  user: string | null;
  ipAddress: string | null;
  occurredAt: string;
};

export function serializeAudit(
  rows: {
    id: string;
    action: string;
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    versionLabel: string | null;
    ipAddress: string | null;
    occurredAt: Date;
    user: { username: string } | null;
  }[],
): AuditDTO[] {
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    field: r.field,
    oldValue: r.oldValue,
    newValue: r.newValue,
    versionLabel: r.versionLabel,
    user: r.user?.username ?? null,
    ipAddress: r.ipAddress,
    occurredAt: r.occurredAt.toISOString(),
  }));
}

/** The picker data the editor needs. */
export type EditorOptionsDTO = {
  departments: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  employees: { id: string; name: string; empCode: string; designation: string | null; userId: string | null }[];
  hrRoles: { id: string; name: string }[];
  users: { id: string; username: string; label: string }[];
};
