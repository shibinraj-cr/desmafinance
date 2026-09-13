/**
 * The SOP lifecycle (§11, §12, §15, §20).
 *
 *   draft ─┐
 *          ├─→ review_requested ─→ approval_pending ─→ approved ─→ published
 *   changes_requested ↑         └─→ changes_requested ┘
 *   revision_required ┘
 *
 *   published ─→ (create revision) ─→ a NEW draft version ─→ … ─→ published
 *
 * Two rules hold the whole thing together, and every function here enforces
 * them rather than trusting a caller:
 *
 *   1. A published version is FROZEN. `isLocked` goes true at publish and no
 *      write path — not even an admin's — mutates the row or its children
 *      afterwards. Changing a published SOP means a new version.
 *   2. At most ONE in-flight version per SOP. `Sop.draftVersionId` is that
 *      version; a second "create revision" while one is open is refused, so
 *      two people cannot silently fork the same document.
 *
 * The transition table is a pure function (`canTransition`) so the rules are
 * testable without a database, and the DB-touching operations below all consult
 * it rather than re-deriving the rules inline.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, conflict, forbidden, notFound } from "@/lib/http-error";
import { EDITABLE_STATUSES, type SopStatus } from "./constants";
import { computeNextReviewDate, today } from "./review-dates";
import { initialVersion, nextFreeVersion, parseVersionLabel, versionLabel, type VersionBump } from "./versioning";
import { assignAcknowledgements, resolveAudience } from "./acknowledge";
import { recordSopAudit } from "./audit";
import {
  notifyApprovalRequested,
  notifyApproved,
  notifyChangesRequested,
  notifyPublished,
  notifyReviewRequested,
  userIdForEmployee,
  userIdsForEmployees,
} from "./notify";
import type { SopAccess } from "./rbac";
import {
  canApproveVersion,
  canCreateRevision,
  canEditVersion,
  canPublish,
  canRequestReview,
  canReview,
} from "./rbac";

// ── The transition table ────────────────────────────────────────────────────

export const WORKFLOW_ACTIONS = [
  "request_review",
  "submit_for_approval",
  "approve_review",
  "request_changes",
  "approve",
  "publish",
] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export const WORKFLOW_ACTION_LABELS: Record<WorkflowAction, string> = {
  request_review: "Request Review",
  submit_for_approval: "Submit for Approval",
  approve_review: "Approve Review",
  request_changes: "Request Changes",
  approve: "Approve",
  publish: "Publish",
};

/**
 * Allowed (from → to) per action.
 *
 * `submit_for_approval` exists for the case §26 describes and §11's diagram
 * does not: an SOP with no separate reviewer named. Rather than invent a
 * pretend review step, the author sends it straight to the approver — the
 * approval gate is never skipped, only the review one, and only when no
 * reviewer was ever assigned. `requireApproverNamed` / `requireReviewerNamed`
 * are checked by the callers below.
 */
const TRANSITIONS: Record<WorkflowAction, { from: SopStatus[]; to: SopStatus }> = {
  request_review: { from: ["draft", "changes_requested", "revision_required"], to: "review_requested" },
  submit_for_approval: { from: ["draft", "changes_requested", "revision_required"], to: "approval_pending" },
  approve_review: { from: ["review_requested"], to: "approval_pending" },
  request_changes: { from: ["review_requested", "approval_pending"], to: "changes_requested" },
  approve: { from: ["approval_pending"], to: "approved" },
  publish: { from: ["approved"], to: "published" },
};

/** The status an action lands on, or null when the action is not legal here. */
export function canTransition(from: string, action: WorkflowAction): SopStatus | null {
  const rule = TRANSITIONS[action];
  if (!rule) return null;
  return rule.from.includes(from as SopStatus) ? rule.to : null;
}

/** Every action legal from a given status — what the editor's button bar shows. */
export function availableActions(from: string): WorkflowAction[] {
  return WORKFLOW_ACTIONS.filter((a) => canTransition(from, a) !== null);
}

/** Is this version's content still editable? (Status only — see canEditVersion for authority.) */
export function isEditableStatus(status: string): boolean {
  return EDITABLE_STATUSES.includes(status as SopStatus);
}

// ── Shared loader ───────────────────────────────────────────────────────────

/** Everything an authorisation + transition decision needs, in one query. */
export async function loadVersionForAction(versionId: string) {
  const version = await prisma.sopVersion.findUnique({
    where: { id: versionId },
    include: {
      sop: {
        select: {
          id: true,
          sopNumber: true,
          title: true,
          ownerEmployeeId: true,
          departmentId: true,
          confidentiality: true,
          createdById: true,
          isArchived: true,
          deletedAt: true,
          currentVersionId: true,
          draftVersionId: true,
        },
      },
    },
  });
  if (!version) throw notFound("SOP version not found.");
  if (version.sop.deletedAt) throw notFound("SOP version not found.");
  return version;
}

type LoadedVersion = Awaited<ReturnType<typeof loadVersionForAction>>;

/** The shape `rbac.ts` expects for a Sop. */
function sopLike(v: LoadedVersion) {
  return {
    id: v.sop.id,
    ownerEmployeeId: v.sop.ownerEmployeeId,
    departmentId: v.sop.departmentId,
    confidentiality: v.sop.confidentiality,
    createdById: v.sop.createdById,
    isArchived: v.sop.isArchived,
    deletedAt: v.sop.deletedAt,
  };
}

/** The shape `rbac.ts` expects for a version. */
function versionLike(v: LoadedVersion) {
  return {
    id: v.id,
    status: v.status,
    isLocked: v.isLocked,
    reviewerId: v.reviewerId,
    approverId: v.approverId,
    createdById: v.createdById,
    ownerEmployeeId: v.ownerEmployeeId,
    confidentiality: v.confidentiality,
    departmentId: v.departmentId,
    applicableDepartmentIds: v.applicableDepartmentIds,
    applicableRoleIds: v.applicableRoleIds,
    applicableEmployeeIds: v.applicableEmployeeIds,
  };
}

/**
 * The `Sop.status` a transition should leave behind.
 *
 * A published SOP keeps reading as "published" while a REVISION moves through
 * review and approval underneath it: the document in force has not changed,
 * only the draft has. Without this, starting a revision would drop the SOP out
 * of the library (which filters on `status = published`) until the revision was
 * published — i.e. editing a procedure would make it disappear from the library
 * for as long as the edit took.
 *
 * Before the first publish there is nothing in force, so the SOP simply tracks
 * its draft. The dashboard still surfaces in-flight revisions: its workflow
 * counts come from SopVersion, not from this column (see dashboardCounts).
 */
function denormalisedStatus(
  sop: { currentVersionId: string | null },
  versionStatus: SopStatus,
): SopStatus {
  return sop.currentVersionId ? "published" : versionStatus;
}

/**
 * The guard every content-mutating route calls before touching a version or any
 * of its children. Throws rather than returning a boolean so a caller cannot
 * forget to check the result.
 */
export async function assertVersionEditable(
  versionId: string,
  access: SopAccess,
): Promise<LoadedVersion> {
  const version = await loadVersionForAction(versionId);
  if (version.isLocked) {
    throw conflict(
      "This version is published and cannot be edited. Create a revision instead.",
      "version_locked",
    );
  }
  if (!canEditVersion(access, sopLike(version), version)) throw forbidden();
  return version;
}

// ── Workflow operations ─────────────────────────────────────────────────────

export type WorkflowResult = { status: SopStatus; versionId: string; sopId: string };

/** draft → review_requested. Requires a reviewer to be named. */
export async function requestReview(
  versionId: string,
  access: SopAccess,
  comments: string | null,
): Promise<WorkflowResult> {
  const version = await loadVersionForAction(versionId);
  if (!canRequestReview(access, sopLike(version), version)) throw forbidden();

  const to = canTransition(version.status, "request_review");
  if (!to) throw conflict(`An SOP in "${version.status}" cannot be sent for review.`, "bad_transition");
  if (!version.reviewerId) {
    throw badRequest("Name a reviewer before requesting review.", "reviewer_required");
  }
  await assertReadyForReview(version);

  await prisma.$transaction([
    prisma.sopVersion.update({
      where: { id: version.id },
      data: { status: to, submittedForReviewAt: new Date() },
    }),
    prisma.sopReviewAction.create({
      data: { versionId: version.id, stage: "review", decision: "submitted", comments, actorId: access.userId },
    }),
    prisma.sop.update({
      where: { id: version.sopId },
      data: { status: denormalisedStatus(version.sop, to) },
    }),
  ]);

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "REVIEW_REQUESTED",
    newValue: to,
    metadata: { reviewerId: version.reviewerId },
  });
  await notifyReviewRequested({
    sop: version.sop,
    versionId: version.id,
    versionLabel: version.versionLabel,
    reviewerId: version.reviewerId,
    actorUserId: access.userId,
  });

  return { status: to, versionId: version.id, sopId: version.sopId };
}

/**
 * draft → approval_pending, for an SOP with no separate reviewer. Refused when
 * a reviewer IS named — skipping a review someone was assigned would make the
 * assignment meaningless.
 */
export async function submitForApproval(
  versionId: string,
  access: SopAccess,
  comments: string | null,
): Promise<WorkflowResult> {
  const version = await loadVersionForAction(versionId);
  if (!canRequestReview(access, sopLike(version), version)) throw forbidden();

  const to = canTransition(version.status, "submit_for_approval");
  if (!to) throw conflict(`An SOP in "${version.status}" cannot be submitted for approval.`, "bad_transition");
  if (version.reviewerId) {
    throw badRequest(
      "This SOP has a reviewer assigned — request review first.",
      "review_required",
    );
  }
  if (!version.approverId) {
    throw badRequest("Name an approver before submitting for approval.", "approver_required");
  }
  await assertReadyForReview(version);

  await prisma.$transaction([
    prisma.sopVersion.update({
      where: { id: version.id },
      data: { status: to, submittedForApprovalAt: new Date() },
    }),
    prisma.sopReviewAction.create({
      data: { versionId: version.id, stage: "approval", decision: "submitted", comments, actorId: access.userId },
    }),
    prisma.sop.update({
      where: { id: version.sopId },
      data: { status: denormalisedStatus(version.sop, to) },
    }),
  ]);

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "SUBMITTED_FOR_APPROVAL",
    newValue: to,
  });
  await notifyApprovalRequested({
    sop: version.sop,
    versionId: version.id,
    versionLabel: version.versionLabel,
    approverId: version.approverId,
    actorUserId: access.userId,
  });

  return { status: to, versionId: version.id, sopId: version.sopId };
}

/** The reviewer's verdict: pass it on, or send it back. */
export async function decideReview(
  versionId: string,
  access: SopAccess,
  decision: "approve" | "request_changes",
  comments: string | null,
): Promise<WorkflowResult> {
  const version = await loadVersionForAction(versionId);
  if (!canReview(access, sopLike(version), versionLike(version))) throw forbidden();

  if (decision === "request_changes") {
    return await sendBack(version, access, "review", comments);
  }

  const to = canTransition(version.status, "approve_review");
  if (!to) throw conflict("This SOP is not awaiting review.", "bad_transition");
  if (!version.approverId) {
    throw badRequest(
      "Name an approver before approving the review — there is nobody to send it to.",
      "approver_required",
    );
  }

  await prisma.$transaction([
    prisma.sopVersion.update({
      where: { id: version.id },
      data: {
        status: to,
        reviewedAt: new Date(),
        reviewedById: access.userId,
        submittedForApprovalAt: new Date(),
      },
    }),
    prisma.sopReviewAction.create({
      data: { versionId: version.id, stage: "review", decision: "approved", comments, actorId: access.userId },
    }),
    prisma.sop.update({
      where: { id: version.sopId },
      data: { status: denormalisedStatus(version.sop, to) },
    }),
  ]);

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "REVIEW_APPROVED",
    newValue: to,
  });
  await notifyApprovalRequested({
    sop: version.sop,
    versionId: version.id,
    versionLabel: version.versionLabel,
    approverId: version.approverId,
    actorUserId: access.userId,
  });

  return { status: to, versionId: version.id, sopId: version.sopId };
}

/** The approver's verdict. */
export async function decideApproval(
  versionId: string,
  access: SopAccess,
  decision: "approve" | "request_changes",
  comments: string | null,
): Promise<WorkflowResult> {
  const version = await loadVersionForAction(versionId);
  if (!canApproveVersion(access, sopLike(version), versionLike(version))) throw forbidden();

  if (decision === "request_changes") {
    return await sendBack(version, access, "approval", comments);
  }

  const to = canTransition(version.status, "approve");
  if (!to) throw conflict("This SOP is not awaiting approval.", "bad_transition");

  await prisma.$transaction([
    prisma.sopVersion.update({
      where: { id: version.id },
      data: { status: to, approvedAt: new Date(), approvedById: access.userId },
    }),
    prisma.sopReviewAction.create({
      data: { versionId: version.id, stage: "approval", decision: "approved", comments, actorId: access.userId },
    }),
    prisma.sop.update({
      where: { id: version.sopId },
      data: { status: denormalisedStatus(version.sop, to) },
    }),
  ]);

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "APPROVED",
    newValue: to,
  });
  // Tell the people who now have something to do: the author, the owner, and
  // whoever can publish it.
  await notifyApproved({
    sop: version.sop,
    versionId: version.id,
    versionLabel: version.versionLabel,
    recipients: [version.createdById, await userIdForEmployee(version.ownerEmployeeId)],
    actorUserId: access.userId,
  });

  return { status: to, versionId: version.id, sopId: version.sopId };
}

/**
 * "Request changes", from whichever gate the version is currently at.
 *
 * The stage is read off the version's status rather than taken from the
 * caller: the same button appears to the reviewer and to the approver, and
 * letting the client name the stage would let a reviewer post a decision as
 * though they were the approver.
 */
export async function requestChanges(
  versionId: string,
  access: SopAccess,
  comments: string | null,
): Promise<WorkflowResult> {
  const version = await loadVersionForAction(versionId);
  if (version.status === "review_requested") {
    return decideReview(versionId, access, "request_changes", comments);
  }
  if (version.status === "approval_pending") {
    return decideApproval(versionId, access, "request_changes", comments);
  }
  throw conflict("This SOP is not awaiting a review or an approval.", "bad_transition");
}

/** Shared "send it back to the author" path for both gates. */
async function sendBack(
  version: LoadedVersion,
  access: SopAccess,
  stage: "review" | "approval",
  comments: string | null,
): Promise<WorkflowResult> {
  const to = canTransition(version.status, "request_changes");
  if (!to) throw conflict("This SOP is not in a stage that can be sent back.", "bad_transition");

  await prisma.$transaction([
    prisma.sopVersion.update({ where: { id: version.id }, data: { status: to } }),
    prisma.sopReviewAction.create({
      data: { versionId: version.id, stage, decision: "changes_requested", comments, actorId: access.userId },
    }),
    prisma.sop.update({
      where: { id: version.sopId },
      data: { status: denormalisedStatus(version.sop, to) },
    }),
  ]);

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "CHANGES_REQUESTED",
    newValue: to,
    metadata: { stage, comments },
  });
  await notifyChangesRequested({
    sop: version.sop,
    versionId: version.id,
    versionLabel: version.versionLabel,
    recipients: [version.createdById, await userIdForEmployee(version.ownerEmployeeId)],
    comments,
    actorUserId: access.userId,
  });

  return { status: to, versionId: version.id, sopId: version.sopId };
}

// ── Publish ─────────────────────────────────────────────────────────────────

export type PublishSettings = {
  effectiveDate: Date;
  nextReviewDate: Date | null;
  applicableDepartmentIds: string[];
  applicableRoleIds: string[];
  applicableEmployeeIds: string[];
  requiresAcknowledgement: boolean;
  acknowledgementDeadline: Date | null;
  publishNotes: string | null;
};

/**
 * Publish an approved version.
 *
 * Everything that decides what the SOP now IS happens inside one transaction —
 * lock the version, retire the previous published one, repoint the Sop, clear
 * the draft slot. Acknowledgement rows and notifications are written after it
 * commits: they are consequences of a publish that has already happened, and
 * holding a transaction open across a roster-wide insert would be the wrong
 * trade.
 */
export async function publishVersion(
  versionId: string,
  access: SopAccess,
  settings: PublishSettings,
): Promise<WorkflowResult> {
  const version = await loadVersionForAction(versionId);
  if (!canPublish(access, sopLike(version), version)) throw forbidden();
  if (canTransition(version.status, "publish") === null) {
    throw conflict("Only an approved SOP can be published.", "bad_transition");
  }
  if (settings.requiresAcknowledgement) {
    const hasAudience =
      settings.applicableDepartmentIds.length > 0 ||
      settings.applicableRoleIds.length > 0 ||
      settings.applicableEmployeeIds.length > 0;
    if (!hasAudience) {
      throw badRequest(
        "Choose who must acknowledge this SOP — departments, roles or named employees.",
        "audience_required",
      );
    }
  }

  // Fall back to the review schedule when the modal left the next review blank.
  const nextReview =
    settings.nextReviewDate ??
    computeNextReviewDate(settings.effectiveDate, version.reviewFrequency, version.reviewIntervalDays);

  const previousPublishedId = version.sop.currentVersionId;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // The previously live version becomes history, not a second live document.
    if (previousPublishedId && previousPublishedId !== version.id) {
      await tx.sopVersion.update({
        where: { id: previousPublishedId },
        data: { status: "archived", archivedAt: now },
      });
    }

    await tx.sopVersion.update({
      where: { id: version.id },
      data: {
        status: "published",
        isLocked: true,
        publishedAt: now,
        publishedById: access.userId,
        effectiveDate: settings.effectiveDate,
        nextReviewDate: nextReview,
        lastReviewDate: version.lastReviewDate ?? settings.effectiveDate,
        applicableDepartmentIds: settings.applicableDepartmentIds,
        applicableRoleIds: settings.applicableRoleIds,
        applicableEmployeeIds: settings.applicableEmployeeIds,
        requiresAcknowledgement: settings.requiresAcknowledgement,
        acknowledgementDeadline: settings.acknowledgementDeadline,
        publishNotes: settings.publishNotes,
      },
    });

    await tx.sopReviewAction.create({
      data: {
        versionId: version.id,
        stage: "approval",
        decision: "published",
        comments: settings.publishNotes,
        actorId: access.userId,
      },
    });

    // The Sop row's denormalised copy of "what is live right now".
    await tx.sop.update({
      where: { id: version.sopId },
      data: {
        currentVersionId: version.id,
        draftVersionId: null,
        status: "published",
        title: version.title,
        departmentId: version.departmentId,
        categoryId: version.categoryId,
        processFunction: version.processFunction,
        ownerEmployeeId: version.ownerEmployeeId,
        confidentiality: version.confidentiality,
        effectiveDate: settings.effectiveDate,
        nextReviewDate: nextReview,
        requiresAcknowledgement: settings.requiresAcknowledgement,
      },
    });
  });

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "PUBLISHED",
    newValue: "published",
    metadata: {
      effectiveDate: settings.effectiveDate.toISOString().slice(0, 10),
      nextReviewDate: nextReview?.toISOString().slice(0, 10) ?? null,
      requiresAcknowledgement: settings.requiresAcknowledgement,
      supersededVersionId: previousPublishedId,
    },
  });

  // Audience → acknowledgement rows → notifications.
  const audience = await resolveAudience({
    departmentIds: settings.applicableDepartmentIds,
    roleIds: settings.applicableRoleIds,
    employeeIds: settings.applicableEmployeeIds,
  });
  if (settings.requiresAcknowledgement) {
    await assignAcknowledgements({
      sopId: version.sopId,
      versionId: version.id,
      employeeIds: audience,
      deadline: settings.acknowledgementDeadline,
    });
  }
  await notifyPublished({
    sop: version.sop,
    versionId: version.id,
    versionLabel: version.versionLabel,
    recipients: await userIdsForEmployees(audience),
    requiresAcknowledgement: settings.requiresAcknowledgement,
    deadline: settings.acknowledgementDeadline,
    actorUserId: access.userId,
  });

  return { status: "published", versionId: version.id, sopId: version.sopId };
}

// ── Revision ────────────────────────────────────────────────────────────────

/**
 * Start the next version of a published SOP: a deep copy of the version being
 * revised, in `draft`, with the workflow fields cleared.
 *
 * A copy, not a pointer: the new draft has to be freely editable while the
 * published one stays exactly as approved, and sharing child rows between them
 * would make the first edit rewrite history.
 */
export async function createRevision(
  sopId: string,
  access: SopAccess,
  opts: { bump: VersionBump; changeSummary: string | null },
): Promise<{ sopId: string; versionId: string; versionLabel: string }> {
  const sop = await prisma.sop.findUnique({
    where: { id: sopId },
    include: {
      versions: { select: { id: true, versionLabel: true, major: true, minor: true } },
    },
  });
  if (!sop || sop.deletedAt) throw notFound("SOP not found.");
  if (!canCreateRevision(access, sop)) throw forbidden();
  if (sop.draftVersionId) {
    throw conflict(
      "This SOP already has a revision in progress. Finish or discard it first.",
      "revision_in_progress",
    );
  }
  if (!sop.currentVersionId) {
    throw badRequest("Only a published SOP can be revised.", "not_published");
  }

  const source = await loadFullVersion(sop.currentVersionId);
  if (!source) throw notFound("The published version could not be loaded.");

  const from = parseVersionLabel(source.versionLabel) ?? initialVersion();
  const next = nextFreeVersion(from, opts.bump, sop.versions.map((v) => v.versionLabel));
  const label = versionLabel(next);

  const created = await prisma.$transaction(async (tx) => {
    const draft = await tx.sopVersion.create({
      data: {
        sopId: sop.id,
        versionLabel: label,
        major: next.major,
        minor: next.minor,
        status: "draft",
        isLocked: false,
        previousVersionId: source.id,
        changeSummary: opts.changeSummary,

        // Content carried forward verbatim.
        title: source.title,
        departmentId: source.departmentId,
        categoryId: source.categoryId,
        processFunction: source.processFunction,
        ownerEmployeeId: source.ownerEmployeeId,
        supportingRoleIds: source.supportingRoleIds,
        confidentiality: source.confidentiality,
        reviewerId: source.reviewerId,
        approverId: source.approverId,
        purpose: source.purpose,
        triggerDescription: source.triggerDescription,
        triggerType: source.triggerType,
        triggerSource: source.triggerSource,
        triggerCondition: source.triggerCondition,
        qualityStandard: source.qualityStandard,
        reviewFrequency: source.reviewFrequency,
        reviewIntervalDays: source.reviewIntervalDays,
        reviewOwnerEmployeeId: source.reviewOwnerEmployeeId,
        reviewReminderDays: source.reviewReminderDays,
        lastReviewDate: source.lastReviewDate,
        // Publication settings are carried forward as DEFAULTS for the modal,
        // but effectiveDate is not: the new version takes effect when it is
        // published, not when its predecessor did.
        applicableDepartmentIds: source.applicableDepartmentIds,
        applicableRoleIds: source.applicableRoleIds,
        applicableEmployeeIds: source.applicableEmployeeIds,
        requiresAcknowledgement: source.requiresAcknowledgement,

        createdById: access.userId,
      },
    });

    for (const step of source.steps) {
      const copy = await tx.sopStep.create({
        data: {
          versionId: draft.id,
          seq: step.seq,
          title: step.title,
          instruction: step.instruction,
          responsibleRoleId: step.responsibleRoleId,
          responsibleRoleName: step.responsibleRoleName,
          responsibleDepartmentId: step.responsibleDepartmentId,
          assignedEmployeeId: step.assignedEmployeeId,
          slaValue: step.slaValue,
          slaUnit: step.slaUnit,
          slaMinutes: step.slaMinutes,
          requiredInput: step.requiredInput,
          expectedOutput: step.expectedOutput,
          evidence: step.evidence,
          supportingDocument: step.supportingDocument,
          templateRef: step.templateRef,
          linkUrl: step.linkUrl,
          notes: step.notes,
        },
      });
      if (step.checklists.length > 0) {
        await tx.sopStepChecklist.createMany({
          data: step.checklists.map((c) => ({
            stepId: copy.id,
            seq: c.seq,
            text: c.text,
            isMandatory: c.isMandatory,
          })),
        });
      }
    }

    if (source.qualityCriteria.length > 0) {
      await tx.sopQualityCriterion.createMany({
        data: source.qualityCriteria.map((q) => ({
          versionId: draft.id,
          seq: q.seq,
          criterion: q.criterion,
          target: q.target,
          isMandatory: q.isMandatory,
        })),
      });
    }

    if (source.exceptions.length > 0) {
      await tx.sopException.createMany({
        data: source.exceptions.map((x) => ({
          versionId: draft.id,
          seq: x.seq,
          issue: x.issue,
          condition: x.condition,
          requiredAction: x.requiredAction,
          escalateToRoleId: x.escalateToRoleId,
          escalateToRoleName: x.escalateToRoleName,
          escalateToEmployeeId: x.escalateToEmployeeId,
          escalationSla: x.escalationSla,
          escalationUnit: x.escalationUnit,
          escalationMinutes: x.escalationMinutes,
          priority: x.priority,
          notifyProcessOwner: x.notifyProcessOwner,
          notifyDepartmentHead: x.notifyDepartmentHead,
        })),
      });
    }

    if (source.kpis.length > 0) {
      // KPI DEFINITIONS carry forward; their recorded results do not. A KPI
      // review measures the version that was live when the work happened, so
      // copying old actuals onto a new version would misattribute them.
      await tx.sopKpi.createMany({
        data: source.kpis.map((k) => ({
          versionId: draft.id,
          seq: k.seq,
          name: k.name,
          description: k.description,
          target: k.target,
          unit: k.unit,
          measurementMethod: k.measurementMethod,
          dataSource: k.dataSource,
          reviewFrequency: k.reviewFrequency,
          kpiOwnerEmployeeId: k.kpiOwnerEmployeeId,
        })),
      });
    }

    if (source.attachments.length > 0) {
      await tx.sopAttachment.createMany({
        data: source.attachments.map((a) => ({
          versionId: draft.id,
          title: a.title,
          docType: a.docType,
          fileUrl: a.fileUrl,
          linkUrl: a.linkUrl,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          docVersion: a.docVersion,
          uploadedById: a.uploadedById,
        })),
      });
    }

    // The SOP itself stays "published" — see denormalisedStatus. Only the
    // draft slot changes.
    await tx.sop.update({
      where: { id: sop.id },
      data: { draftVersionId: draft.id, status: sop.currentVersionId ? "published" : "draft" },
    });

    return draft;
  });

  await recordSopAudit({
    sopId: sop.id,
    versionId: created.id,
    versionLabel: label,
    userId: access.userId,
    action: "REVISION_CREATED",
    oldValue: source.versionLabel,
    newValue: label,
    metadata: { bump: opts.bump, changeSummary: opts.changeSummary },
  });

  return { sopId: sop.id, versionId: created.id, versionLabel: label };
}

/** Every child row of a version — the deep-copy source. */
export async function loadFullVersion(versionId: string) {
  return prisma.sopVersion.findUnique({
    where: { id: versionId },
    include: {
      steps: { orderBy: { seq: "asc" }, include: { checklists: { orderBy: { seq: "asc" } } } },
      qualityCriteria: { orderBy: { seq: "asc" } },
      exceptions: { orderBy: { seq: "asc" } },
      kpis: { orderBy: { seq: "asc" } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
}

// ── Archive ─────────────────────────────────────────────────────────────────

export async function archiveSop(
  sopId: string,
  access: SopAccess,
  opts: { reason: string; replacementSopId: string | null; archiveDate: Date | null },
): Promise<void> {
  const sop = await prisma.sop.findUnique({ where: { id: sopId } });
  if (!sop || sop.deletedAt) throw notFound("SOP not found.");
  if (!access.canArchive) throw forbidden();
  if (sop.isArchived) throw conflict("This SOP is already archived.", "already_archived");
  if (opts.replacementSopId) {
    if (opts.replacementSopId === sopId) {
      throw badRequest("An SOP cannot replace itself.", "self_replacement");
    }
    const replacement = await prisma.sop.findFirst({
      where: { id: opts.replacementSopId, deletedAt: null },
      select: { id: true },
    });
    if (!replacement) throw badRequest("The replacement SOP was not found.", "bad_replacement");
  }

  const at = opts.archiveDate ?? new Date();
  await prisma.$transaction([
    prisma.sop.update({
      where: { id: sopId },
      data: {
        isArchived: true,
        archivedAt: at,
        archivedById: access.userId,
        archiveReason: opts.reason,
        replacementSopId: opts.replacementSopId,
        status: "archived",
      },
    }),
    // Every version goes with it, including any in-flight draft — an archived
    // SOP must not leave a revision quietly working its way to publication.
    prisma.sopVersion.updateMany({
      where: { sopId, status: { not: "archived" } },
      data: { status: "archived", archivedAt: at },
    }),
  ]);

  await recordSopAudit({
    sopId,
    userId: access.userId,
    action: "ARCHIVED",
    newValue: "archived",
    metadata: { reason: opts.reason, replacementSopId: opts.replacementSopId },
  });
}

/**
 * Bring an archived SOP back. The published version returns to `published` and
 * the SOP becomes live again; drafts stay archived, since a half-finished
 * revision from before the archive is rarely what anyone wants resurrected.
 */
export async function unarchiveSop(sopId: string, access: SopAccess): Promise<void> {
  const sop = await prisma.sop.findUnique({ where: { id: sopId } });
  if (!sop || sop.deletedAt) throw notFound("SOP not found.");
  if (!access.canArchive) throw forbidden();
  if (!sop.isArchived) throw conflict("This SOP is not archived.", "not_archived");

  await prisma.$transaction([
    prisma.sop.update({
      where: { id: sopId },
      data: {
        isArchived: false,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        replacementSopId: null,
        status: sop.currentVersionId ? "published" : "draft",
      },
    }),
    ...(sop.currentVersionId
      ? [
          prisma.sopVersion.update({
            where: { id: sop.currentVersionId },
            data: { status: "published", archivedAt: null },
          }),
        ]
      : []),
  ]);

  await recordSopAudit({
    sopId,
    userId: access.userId,
    action: "UNARCHIVED",
    newValue: sop.currentVersionId ? "published" : "draft",
  });
}

// ── Completeness ────────────────────────────────────────────────────────────

export type SectionKey =
  | "basic"
  | "purpose"
  | "trigger"
  | "steps"
  | "quality"
  | "exceptions"
  | "kpis"
  | "review"
  | "attachments";

/** Which editor sections are filled in — the left navigator's tick marks. */
export type Completeness = Record<SectionKey, boolean>;

export function sectionCompleteness(v: {
  title: string;
  ownerEmployeeId: string | null;
  departmentId: string | null;
  purpose: string | null;
  triggerDescription: string | null;
  triggerType: string | null;
  qualityStandard: string | null;
  reviewFrequency: string | null;
  nextReviewDate: Date | null;
  steps: unknown[];
  qualityCriteria: unknown[];
  exceptions: unknown[];
  kpis: unknown[];
  attachments: unknown[];
}): Completeness {
  return {
    basic: !!v.title.trim() && !!v.ownerEmployeeId && !!v.departmentId,
    purpose: !!v.purpose?.trim(),
    trigger: !!v.triggerDescription?.trim() || !!v.triggerType,
    steps: v.steps.length > 0,
    quality: !!v.qualityStandard?.trim() || v.qualityCriteria.length > 0,
    exceptions: v.exceptions.length > 0,
    kpis: v.kpis.length > 0,
    review: !!v.reviewFrequency || !!v.nextReviewDate,
    attachments: v.attachments.length > 0,
  };
}

/**
 * The bar an SOP must clear to leave the author's hands.
 *
 * Deliberately short: title, owner, purpose and at least one step. Exceptions,
 * KPIs and attachments are genuinely optional for some SOPs, and a gate that
 * demands them would only teach people to type placeholder rows.
 */
async function assertReadyForReview(version: { id: string; title: string; ownerEmployeeId: string; purpose: string | null }) {
  const problems: string[] = [];
  if (!version.title.trim()) problems.push("a title");
  if (!version.ownerEmployeeId) problems.push("a process owner");
  if (!version.purpose?.trim()) problems.push("a purpose");
  const steps = await prisma.sopStep.count({ where: { versionId: version.id } });
  if (steps === 0) problems.push("at least one step");
  if (problems.length > 0) {
    throw badRequest(`This SOP still needs ${formatList(problems)}.`, "incomplete");
  }
}

function formatList(items: string[]): string {
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Re-exported so routes need one import for the "is this a real conflict" test. */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Today as a UTC calendar date — re-exported so routes do not reach past this module. */
export { today };
