// Undo an enrollment — the "dedicated action" the enroll path, the lead PATCH
// route and the detail UI all defer to when they refuse to let a lead leave the
// "Enrolled" status through the ordinary status picker.
//
// Enrolling is not a label change: `enrollLead` (src/lib/crm-enroll.ts) writes
// across four systems of record in one transaction —
//
//   1. Marketing  — LeadPulsePipeline flipped to `closed_won` with a close date,
//                   plus a LeadPulseDailyClose and a +1 on the owner's daily
//                   entry `closedWon` (this is what the Pipeline Forecast
//                   "Actual" column and every month-bucketed CRM metric count).
//   2. Finance    — a Revenue TransactionDraft dropped into the draft-first
//                   reviewer's My-Drafts queue.
//   3. Operations — a PartyService (the quoted package amount) and, when the
//                   service has an active ProcessTemplate, an OpsProject with a
//                   full snapshot of the process steps.
//   4. CRM        — status → Enrolled, party/pipeline/service/value linked.
//
// An accidental enroll therefore leaves real money in a finance queue, a phantom
// win in a BDE's numbers, and an operations project the team will start working.
// Flipping the status back would strand all of it, which is exactly why the
// plain PATCH refuses. This module unwinds each side deliberately, in the same
// order, and refuses outright when the money has already moved past the draft
// stage (see `revenue_committed` below) — a recorded transaction is Finance's to
// reverse, never ours to silently delete.
import { prisma } from "./prisma";
import { badRequest, HttpError } from "./http-error";
import { recordLeadActivity } from "./crm-activity";
import { recordOpsActivity } from "./ops-activity";
import { recordAudit } from "./audit";
import { syncPipelineToLeadStatus } from "./crm-enroll";
import { canUnenrollInto } from "./crm-leads";

/**
 * How close (ms) a row's `createdAt` must be to the ENROLLED activity for us to
 * conclude *this* enrollment created it. Everything enroll writes lands in one
 * transaction and the activity is logged immediately after it commits, so the
 * real gap is sub-second; the window is generous purely to absorb clock skew
 * between the app and the database. Anything older pre-dates the enrollment and
 * is left alone.
 */
const CREATED_BY_ENROLL_WINDOW_MS = 5 * 60 * 1000;

function createdByThisEnroll(createdAt: Date, enrolledAt: Date | null): boolean {
  if (!enrolledAt) return false;
  return Math.abs(createdAt.getTime() - enrolledAt.getTime()) <= CREATED_BY_ENROLL_WINDOW_MS;
}

export type UnenrollBlocker = { code: string; message: string };
export type UnenrollWarning = { code: string; message: string };

/**
 * Everything the confirm dialog needs: what un-enrolling will undo, what it will
 * deliberately leave behind, what needs acknowledging, and what makes it refuse.
 * Computed read-only so the UI can show it before the user commits.
 */
export type UnenrollPlan = {
  leadId: string;
  candidateName: string;
  serviceName: string | null;
  enrolledValue: number | null;
  enrolledAt: string | null;
  /** Non-empty → the action refuses. Nothing is undone while a blocker stands. */
  blockers: UnenrollBlocker[];
  /** Real but non-fatal — the caller must pass `acknowledge: true` to proceed. */
  warnings: UnenrollWarning[];
  /** Plain-language list of what will be reversed. */
  effects: string[];
  /** Deliberately NOT touched, so the dialog can say so rather than surprise. */
  retained: string[];
};

type ResolvedState = {
  lead: {
    id: string;
    candidateName: string;
    statusCode: string;
    statusLabel: string;
    partyId: string | null;
    pipelineId: string | null;
    serviceId: string | null;
    expectedValue: number | null;
  };
  serviceName: string | null;
  enrolledAt: Date | null;
  pipeline: { id: string; status: string; dailyCloseId: string | null } | null;
  /** The enrollment's revenue draft, when it is still sitting in My Drafts. */
  draft: { id: string; amount: number; submittedByName: string | null } | null;
  /** Recorded draft id whose row is gone AND was never discarded → money moved on. */
  committedDraftId: string | null;
  partyService: { id: string; createdAt: Date } | null;
  opsProject: { id: string; status: string; taskCount: number; touched: number; docs: number; items: number } | null;
};

/**
 * Read every row the enrollment touched, plus enough provenance to tell what it
 * created from what already existed. Pure reads — safe to call from the preview
 * endpoint on every dialog open.
 */
async function resolveState(leadId: string): Promise<ResolvedState> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      candidateName: true,
      partyId: true,
      pipelineId: true,
      serviceId: true,
      expectedValue: true,
      status: { select: { code: true, label: true } },
      service: { select: { name: true } },
    },
  });
  if (!lead) throw new HttpError(404, "Lead not found", "not_found");

  // The ENROLLED activity is our provenance anchor: its timestamp tells us which
  // rows this enrollment created versus which it merely linked to.
  const enrolledActivity = await prisma.leadActivity.findFirst({
    where: { leadId, type: "ENROLLED" },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  const enrolledAt = enrolledActivity?.occurredAt ?? null;

  const pipeline = lead.pipelineId
    ? await prisma.leadPulsePipeline.findUnique({
        where: { id: lead.pipelineId },
        select: { id: true, status: true, dailyCloseId: true },
      })
    : null;

  // ── Finance ──────────────────────────────────────────────────────────────
  // The draft id is only ever recorded on the REVENUE_DRAFTED activity (there is
  // no FK from the draft back to the lead), so that activity is the only link.
  const draftActivity = await prisma.leadActivity.findFirst({
    where: { leadId, type: "REVENUE_DRAFTED" },
    orderBy: { occurredAt: "desc" },
    select: { metadata: true },
  });
  const recordedDraftId =
    draftActivity && draftActivity.metadata && typeof draftActivity.metadata === "object"
      ? ((draftActivity.metadata as Record<string, unknown>).draftId as string | null | undefined) ?? null
      : null;

  let draft: ResolvedState["draft"] = null;
  let committedDraftId: string | null = null;
  if (recordedDraftId) {
    const row = await prisma.transactionDraft.findUnique({
      where: { id: recordedDraftId },
      select: { id: true, amount: true, submittedBy: { select: { username: true } } },
    });
    if (row) {
      draft = { id: row.id, amount: Number(row.amount.toString()), submittedByName: row.submittedBy?.username ?? null };
    } else {
      // The row is gone. Two very different reasons: the reviewer discarded it
      // (harmless — no money recorded), or it was promoted into a
      // PendingApproval / Transaction (money is in the books). `discardDraft`
      // writes a DRAFT_DISCARD audit; the promote paths do not, so the audit
      // trail is what distinguishes them.
      const discarded = await prisma.auditLog.findFirst({
        where: { entityType: "TransactionDraft", entityId: recordedDraftId, action: "DRAFT_DISCARD" },
        select: { id: true },
      });
      if (!discarded) committedDraftId = recordedDraftId;
    }
  }

  // ── Operations ───────────────────────────────────────────────────────────
  const partyService =
    lead.partyId && lead.serviceId
      ? await prisma.partyService.findUnique({
          where: { partyId_serviceId: { partyId: lead.partyId, serviceId: lead.serviceId } },
          select: { id: true, createdAt: true },
        })
      : null;

  let opsProject: ResolvedState["opsProject"] = null;
  if (partyService) {
    const project = await prisma.opsProject.findUnique({
      where: { partyServiceId: partyService.id },
      select: { id: true, status: true, leadId: true },
    });
    // Only ever touch a project this lead's enrollment created. A project
    // imported from Odoo, or created for a different lead on the same
    // party+service, is not ours to cancel.
    if (project && project.leadId === lead.id) {
      const [taskCount, touched, docs, items] = await Promise.all([
        prisma.opsTask.count({ where: { projectId: project.id } }),
        prisma.opsTask.count({
          where: {
            projectId: project.id,
            OR: [
              { status: { not: "pending" } },
              { startedAt: { not: null } },
              { completedAt: { not: null } },
              { notes: { not: null } },
            ],
          },
        }),
        prisma.opsDocument.count({ where: { task: { projectId: project.id } } }),
        prisma.opsActionItem.count({ where: { projectId: project.id } }),
      ]);
      opsProject = { id: project.id, status: project.status, taskCount, touched, docs, items };
    }
  }

  return {
    lead: {
      id: lead.id,
      candidateName: lead.candidateName,
      statusCode: lead.status.code,
      statusLabel: lead.status.label,
      partyId: lead.partyId,
      pipelineId: lead.pipelineId,
      serviceId: lead.serviceId,
      expectedValue: lead.expectedValue ? Number(lead.expectedValue.toString()) : null,
    },
    serviceName: lead.service?.name ?? null,
    enrolledAt,
    pipeline,
    draft,
    committedDraftId,
    partyService,
    opsProject,
  };
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** Build the human-facing plan (blockers / warnings / effects) from the state. */
function buildPlan(s: ResolvedState): UnenrollPlan {
  const blockers: UnenrollBlocker[] = [];
  const warnings: UnenrollWarning[] = [];
  const effects: string[] = [];
  const retained: string[] = [];

  if (s.lead.statusCode !== "enrolled") {
    blockers.push({
      code: "not_enrolled",
      message: `This lead is ${s.lead.statusLabel}, not Enrolled — there is nothing to undo.`,
    });
  }

  if (s.committedDraftId) {
    blockers.push({
      code: "revenue_committed",
      message:
        "The revenue from this enrollment has already left My Drafts — it is in the approval queue or recorded as a transaction. " +
        "Finance must reverse that entry first; un-enrolling will not delete a recorded transaction.",
    });
  }

  if (s.pipeline?.status === "closed_won") {
    effects.push("Marketing pipeline entry goes from Won back to In forecast (open), and its close date is cleared.");
  }
  if (s.pipeline?.dailyCloseId) {
    effects.push("The closed-won tick is removed from the owning BDE's daily entry, so the month's Actual drops by one.");
  }
  if (s.draft) {
    effects.push(
      `The ${inr(s.draft.amount)} Revenue draft${s.draft.submittedByName ? ` in ${s.draft.submittedByName}'s My Drafts` : ""} is discarded.`,
    );
  } else if (!s.committedDraftId) {
    retained.push("No revenue draft is pending for this enrollment — nothing to discard on the Finance side.");
  }

  if (s.opsProject) {
    const untouched = s.opsProject.touched === 0 && s.opsProject.docs === 0 && s.opsProject.items === 0;
    if (untouched) {
      effects.push(
        `The operations project created on enrollment (${s.opsProject.taskCount} untouched step${s.opsProject.taskCount === 1 ? "" : "s"}) is deleted.`,
      );
    } else {
      effects.push("The operations project is cancelled (its history is kept, not deleted).");
      warnings.push({
        code: "ops_in_progress",
        message:
          `Operations has already worked this project — ${s.opsProject.touched} step${s.opsProject.touched === 1 ? "" : "s"} touched, ` +
          `${s.opsProject.docs} document${s.opsProject.docs === 1 ? "" : "s"}, ${s.opsProject.items} task${s.opsProject.items === 1 ? "" : "s"}. ` +
          "It will be cancelled rather than removed, and a later re-enrollment of this same service will NOT rebuild it automatically.",
      });
    }
  }

  if (s.partyService) {
    if (createdByThisEnroll(s.partyService.createdAt, s.enrolledAt)) {
      effects.push("The candidate's package amount for this service is removed from the Candidate Master.");
    } else {
      retained.push(
        "The candidate already held this service before the enrollment, so its package amount stays — note the enrollment overwrote the amount and the previous figure cannot be restored.",
      );
    }
  }

  retained.push(
    "The candidate's Party record and its link to this lead are kept — Finance may already reference it, and removing a master record is not something an un-enroll should do silently.",
  );

  return {
    leadId: s.lead.id,
    candidateName: s.lead.candidateName,
    serviceName: s.serviceName,
    enrolledValue: s.lead.expectedValue,
    enrolledAt: s.enrolledAt ? s.enrolledAt.toISOString() : null,
    blockers,
    warnings,
    effects,
    retained,
  };
}

/** Read-only preview for the confirm dialog. Never mutates anything. */
export async function previewUnenroll(leadId: string): Promise<UnenrollPlan> {
  return buildPlan(await resolveState(leadId));
}

type UnenrollArgs = {
  leadId: string;
  /** Target CRM status. Must be a real, active, non-action-only status (e.g. Follow-Up). */
  toStatusId: string;
  /** Free-text reason, recorded on the timeline and the audit log. */
  reason?: string | null;
  /** The user has seen and accepted the plan's warnings. Required when any exist. */
  acknowledge?: boolean;
  actorId: string;
};

export type UnenrollResult = {
  plan: UnenrollPlan;
  toStatusLabel: string;
  pipelineReopened: boolean;
  dailyCloseReversed: boolean;
  draftDiscarded: boolean;
  opsProjectDeleted: boolean;
  opsProjectCancelled: boolean;
  partyServiceDeleted: boolean;
};

/**
 * Reverse an enrollment and move the lead to `toStatusId`.
 *
 * Everything that must succeed or fail together runs in one transaction; the
 * activity/audit logging (best-effort by design, like the rest of the CRM) runs
 * after it commits.
 */
export async function unenrollLead(args: UnenrollArgs): Promise<UnenrollResult> {
  const state = await resolveState(args.leadId);
  const plan = buildPlan(state);

  if (plan.blockers.length > 0) {
    throw badRequest(plan.blockers.map((b) => b.message).join(" "), plan.blockers[0].code);
  }
  if (plan.warnings.length > 0 && !args.acknowledge) {
    throw badRequest(plan.warnings.map((w) => w.message).join(" "), "acknowledgement_required");
  }

  const target = await prisma.crmLeadStatus.findUnique({
    where: { id: args.toStatusId },
    select: { id: true, code: true, label: true, active: true },
  });
  if (!target || !target.active) throw badRequest("Pick an active status to move the lead to.", "invalid_status");
  // "Pipeline" is allowed on purpose — the deal survives the undo, so that is
  // where a previously-enrolled lead belongs. Only "Enrolled" (the state we are
  // leaving) and "Duplicate" are refused; see UNENROLL_FORBIDDEN_STATUS_CODES.
  if (!canUnenrollInto(target.code)) {
    throw badRequest(`A lead can't be un-enrolled into "${target.label}".`, "forbidden_status");
  }

  const opsUntouched =
    !!state.opsProject && state.opsProject.touched === 0 && state.opsProject.docs === 0 && state.opsProject.items === 0;
  const partyServiceIsOurs = !!state.partyService && createdByThisEnroll(state.partyService.createdAt, state.enrolledAt);

  const outcome = await prisma.$transaction(async (tx) => {
    // Re-read the status inside the transaction: two admins hitting Un-enroll on
    // the same lead must not both unwind it (the second would decrement a
    // closedWon that is already back to zero).
    const fresh = await tx.lead.findUnique({
      where: { id: state.lead.id },
      select: { id: true, status: { select: { code: true, label: true } } },
    });
    if (!fresh) throw new HttpError(404, "Lead not found", "not_found");
    if (fresh.status.code !== "enrolled") {
      throw badRequest("This lead is no longer Enrolled — it may have just been un-enrolled by someone else.", "not_enrolled");
    }

    // ── 1. Marketing: reverse the win and its daily close ──────────────────
    // Mirrors the reversal `upsertPipeline` performs when a won deal is
    // re-opened: the LeadPulseDailyClose row is deleted and the owner's
    // `closedWon` decremented, and only then is `dailyCloseId` nulled — never
    // blindly, which would orphan the close and leave it counting forever.
    let pipelineReopened = false;
    let dailyCloseReversed = false;
    if (state.pipeline) {
      if (state.pipeline.dailyCloseId) {
        const close = await tx.leadPulseDailyClose.findUnique({
          where: { id: state.pipeline.dailyCloseId },
          select: { id: true, entry: { select: { id: true, closedWon: true } } },
        });
        if (close) {
          await tx.leadPulseDailyClose.delete({ where: { id: close.id } });
          await tx.leadPulseDailyEntry.update({
            where: { id: close.entry.id },
            data: { closedWon: Math.max(0, (close.entry.closedWon ?? 0) - 1) },
          });
          dailyCloseReversed = true;
        }
      }
      // Back to an open forecast entry: the deal was never actually won, but it
      // is still a live deal the BDE is working. A later status change into a
      // lost code re-mirrors it via syncPipelineToLeadStatus below.
      await tx.leadPulsePipeline.update({
        where: { id: state.pipeline.id },
        data: { status: "open", closedDate: null, dailyCloseId: null },
      });
      pipelineReopened = true;
    }

    // ── 2. Finance: discard the untouched revenue draft ────────────────────
    // Safe by construction — a draft row only still exists while it is sitting
    // in My Drafts; resolveState already refused if it had moved downstream.
    let draftDiscarded = false;
    if (state.draft) {
      const still = await tx.transactionDraft.findUnique({ where: { id: state.draft.id }, select: { id: true } });
      if (still) {
        await tx.transactionDraft.delete({ where: { id: state.draft.id } });
        draftDiscarded = true;
      }
    }

    // ── 3. Operations: delete an untouched project, cancel a worked one ────
    let opsProjectDeleted = false;
    let opsProjectCancelled = false;
    if (state.opsProject) {
      if (opsUntouched) {
        // Deleting (rather than cancelling) matters: `createProjectForEnrollment`
        // is idempotent on partyServiceId, so a cancelled shell would make a
        // later, genuine enrollment of this same service silently skip building
        // the project.
        await tx.opsProject.delete({ where: { id: state.opsProject.id } });
        opsProjectDeleted = true;
      } else {
        await tx.opsProject.update({ where: { id: state.opsProject.id }, data: { status: "cancelled" } });
        opsProjectCancelled = true;
      }
    }

    // ── 4. Operations: drop the package amount this enrollment created ─────
    // Only when this enrollment created it. A PartyService that pre-dates the
    // enrollment belongs to the candidate's earlier history; the enrollment
    // overwrote its `totalAmount` and we have no record of the old figure, so
    // the row is left in place and the dialog says so.
    let partyServiceDeleted = false;
    if (state.partyService && partyServiceIsOurs && !opsProjectCancelled) {
      await tx.partyService.delete({ where: { id: state.partyService.id } });
      partyServiceDeleted = true;
    }

    // ── 5. CRM: move the lead to the chosen working status ─────────────────
    // `partyId` and `pipelineId` are deliberately left linked — see `retained`.
    await tx.lead.update({ where: { id: state.lead.id }, data: { statusId: target.id } });

    return {
      fromLabel: fresh.status.label,
      pipelineReopened,
      dailyCloseReversed,
      draftDiscarded,
      opsProjectDeleted,
      opsProjectCancelled,
      partyServiceDeleted,
    };
  });

  // Keep the pipeline mirror honest if the target status is a lost disposition
  // (open → lost). No-op for Follow-Up and every other active status.
  await syncPipelineToLeadStatus({ leadId: state.lead.id, toCode: target.code });

  const undone = [
    outcome.pipelineReopened ? "pipeline re-opened" : null,
    outcome.dailyCloseReversed ? "closed-won reversed" : null,
    outcome.draftDiscarded ? "revenue draft discarded" : null,
    outcome.opsProjectDeleted ? "operations project removed" : null,
    outcome.opsProjectCancelled ? "operations project cancelled" : null,
    outcome.partyServiceDeleted ? "package amount removed" : null,
  ].filter(Boolean) as string[];

  await recordLeadActivity({
    leadId: state.lead.id,
    actorId: args.actorId,
    type: "UNENROLLED",
    summary:
      `Enrollment undone${state.lead.expectedValue ? ` — ${inr(state.lead.expectedValue)}` : ""}` +
      (undone.length ? ` (${undone.join(", ")})` : "") +
      (args.reason ? ` · ${args.reason}` : ""),
    metadata: {
      reason: args.reason ?? null,
      toStatus: target.code,
      partyId: state.lead.partyId,
      pipelineId: state.lead.pipelineId,
      serviceId: state.lead.serviceId,
      draftId: state.draft?.id ?? null,
      opsProjectId: state.opsProject?.id ?? null,
      ...outcome,
    },
  });
  await recordLeadActivity({
    leadId: state.lead.id,
    actorId: args.actorId,
    type: "STATUS_CHANGED",
    summary: `Status changed: ${outcome.fromLabel} → ${target.label}`,
    metadata: { to: target.code, via: "unenroll" },
  });

  // The discarded draft is a Finance-side deletion — record it in the same audit
  // shape `discardDraft` uses, so it reads normally in the finance audit trail.
  if (outcome.draftDiscarded && state.draft) {
    await recordAudit({
      entityType: "TransactionDraft",
      entityId: state.draft.id,
      action: "DRAFT_DISCARD",
      userId: args.actorId,
      changes: { via: "crm_unenroll", leadId: state.lead.id, amount: state.draft.amount },
    });
  }
  if (outcome.opsProjectCancelled && state.opsProject) {
    await recordOpsActivity({
      projectId: state.opsProject.id,
      actorId: args.actorId,
      type: "TASK_CANCELLED",
      summary: `Project cancelled — the CRM enrollment was undone${args.reason ? ` (${args.reason})` : ""}`,
      metadata: { leadId: state.lead.id, via: "crm_unenroll" },
    });
  }
  await recordAudit({
    entityType: "Lead",
    entityId: state.lead.id,
    action: "CRM_UNENROLL",
    userId: args.actorId,
    changes: {
      from: "enrolled",
      to: target.code,
      reason: args.reason ?? null,
      ...outcome,
    },
  });

  return {
    plan,
    toStatusLabel: target.label,
    pipelineReopened: outcome.pipelineReopened,
    dailyCloseReversed: outcome.dailyCloseReversed,
    draftDiscarded: outcome.draftDiscarded,
    opsProjectDeleted: outcome.opsProjectDeleted,
    opsProjectCancelled: outcome.opsProjectCancelled,
    partyServiceDeleted: outcome.partyServiceDeleted,
  };
}
