// Enrollment + deal logic: mirror a lead's deal (service + expected value +
// close date) to a Lead Pulse pipeline entry (so it feeds the Marketing
// "expected to close" projection), and on enroll create/link the candidate in
// the Party master (so Finance can transact) and flip the pipeline to won.
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { badRequest, HttpError } from "./http-error";
import { recordLeadActivity } from "./crm-activity";
import { recordOpsActivity } from "./ops-activity";
import { getActiveTemplateForService } from "./ops-templates";
import { createProjectForEnrollment, resolveDefaultOpsAssignee } from "./ops-projects";
import { loadHolidaySet } from "./ops-dates";
import { monthCodeFromDate, flowFor } from "./catalog";
import { toPrismaDate, fromPrismaDate, todayIst } from "./lead-pulse-dates";
import { isLostStatusCode } from "./crm-reinquiry";

/**
 * Resolve a finance (category, subItem) for a revenue draft from the enrolled
 * service: prefer a SubCategory explicitly mapped to the service, else the
 * first active Revenue category + sub-item. Ganga can re-classify on review.
 */
async function resolveRevenueClassification(
  serviceId: string,
): Promise<{ category: string; subItem: string }> {
  const mapped = await prisma.subCategory.findFirst({
    where: {
      serviceId,
      isActive: true,
      category: { isActive: true, OR: [{ type: "Revenue" }, { type: "Both" }] },
    },
    select: { name: true, category: { select: { name: true } } },
  });
  if (mapped) return { category: mapped.category.name, subItem: mapped.name };
  const cat = await prisma.category.findFirst({
    where: { isActive: true, OR: [{ type: "Revenue" }, { type: "Both" }] },
    orderBy: { name: "asc" },
    select: {
      name: true,
      subItems: { where: { isActive: true }, orderBy: { name: "asc" }, take: 1, select: { name: true } },
    },
  });
  if (cat && cat.subItems[0]) return { category: cat.name, subItem: cat.subItems[0].name };
  return { category: "Sales - Nursing Registrations", subItem: "Renewal Service Charge" };
}

/** A pipeline entry's owner must be an active L2 BDE (the forecast is per-L2). */
export async function isActiveL2(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const r = await prisma.leadPulseRole.findUnique({
    where: { userId },
    select: { role: true, active: true },
  });
  return !!r && r.active && r.role === "l2";
}

/** Prefer the lead's consultant if they're an active L2; else the chosen owner. */
export async function resolvePipelineOwner(
  lead: { assignedToId: string | null },
  ownerUserId?: string | null,
): Promise<string | null> {
  if (lead.assignedToId && (await isActiveL2(lead.assignedToId))) return lead.assignedToId;
  if (ownerUserId && (await isActiveL2(ownerUserId))) return ownerUserId;
  return null;
}

type LeadCore = {
  id: string;
  candidateName: string;
  email: string | null;
  phone: string | null;
  sourceId: string | null;
  serviceId: string | null;
  assignedToId: string | null;
  partyId: string | null;
  pipelineId: string | null;
};

const leadCoreSelect = {
  id: true,
  candidateName: true,
  email: true,
  phone: true,
  sourceId: true,
  serviceId: true,
  assignedToId: true,
  partyId: true,
  pipelineId: true,
} as const;

/**
 * Mirror the Lead Pulse "closed_won" side-effect: bump the owner's daily entry
 * `closedWon` (+1, upserting the day's row) and insert one `LeadPulseDailyClose`
 * tagged with the service. Returns the new close id so the caller can link it on
 * the pipeline (`dailyCloseId`). This is the same write the manual pipeline
 * status route performs (pipeline/[id]/status/route.ts) — without it, CRM
 * enrollments feed `closed_won` revenue but are invisible to every metric that
 * counts `LeadPulseDailyClose` (e.g. the "Actual" column of the Pipeline
 * Forecast). Exported so the one-off backfill can reuse the exact same logic.
 *
 * Unlike the status route this does NOT block on a locked / out-of-backdate-
 * window daily entry: enrollment is an authoritative Finance/Ops action and must
 * never be refused because a BDE's daily sheet for that date is locked.
 */
export async function syncDailyClose(
  tx: Prisma.TransactionClient,
  owner: { userId: string; sourceId: string; serviceId: string },
  closedDate: Date,
): Promise<string> {
  // Snap to the same pure @db.Date value the pipeline.closedDate resolves to, so
  // the unique (userId, entryDate, sourceId) lookup matches — mirrors the status
  // route's toPrismaDate(d.closedDate).
  const entryDate = toPrismaDate(fromPrismaDate(closedDate));

  const existingEntry = await tx.leadPulseDailyEntry.findUnique({
    where: { userId_entryDate_sourceId: { userId: owner.userId, entryDate, sourceId: owner.sourceId } },
  });

  const entry = existingEntry
    ? await tx.leadPulseDailyEntry.update({
        where: { id: existingEntry.id },
        data: { closedWon: (existingEntry.closedWon ?? 0) + 1 },
      })
    : await tx.leadPulseDailyEntry.create({
        data: {
          userId: owner.userId,
          entryDate,
          sourceId: owner.sourceId,
          roleAtEntry: "l2",
          status: "draft",
          receivedFromL1: 0,
          directLeads: 0,
          connected: 0,
          quoteSent: 0,
          closedWon: 1,
          closedLost: 0,
          disqualified: 0,
          locked: false,
        },
      });

  const close = await tx.leadPulseDailyClose.create({
    data: { entryId: entry.id, serviceId: owner.serviceId },
  });
  return close.id;
}

async function upsertPipeline(
  tx: Prisma.TransactionClient,
  lead: LeadCore,
  deal: { serviceId: string; sourceId: string; ownerUserId: string; expectedValue: number; expectedCloseDate: Date },
  status: "open" | "closed_won",
  partyId: string | null,
  // Explicit enrollment (close) date supplied at enroll time. When given it
  // wins — it's what drives the month bucket in every CRM metric. When omitted
  // we keep any existing close date (so editing a deal never re-stamps it) and
  // fall back to now for a brand-new won row.
  closedDateOverride?: Date | null,
): Promise<string> {
  const base = {
    userId: deal.ownerUserId,
    candidateName: lead.candidateName,
    candidatePhone: lead.phone,
    partyId,
    serviceId: deal.serviceId,
    sourceId: deal.sourceId,
    expectedCloseDate: deal.expectedCloseDate,
    expectedFirstInstallment: deal.expectedValue,
    status,
  };
  if (lead.pipelineId) {
    const exists = await tx.leadPulsePipeline.findUnique({
      where: { id: lead.pipelineId },
      select: { id: true, closedDate: true, status: true, dailyCloseId: true },
    });
    if (exists) {
      // Keep an existing close date when staying/becoming won so editing a deal
      // never re-stamps the enrollment date; an explicit override wins; clear it
      // only when re-opening.
      const closedDate = status === "closed_won" ? closedDateOverride ?? exists.closedDate ?? new Date() : null;
      // Log a daily close ONLY on a fresh won flip (was not already won and has
      // no close linked) — so editing a deal on an already-enrolled lead, or a
      // repeat enroll, never double-counts.
      let dailyCloseId: string | undefined;
      if (status === "closed_won" && exists.status !== "closed_won" && !exists.dailyCloseId) {
        dailyCloseId = await syncDailyClose(
          tx,
          { userId: deal.ownerUserId, sourceId: deal.sourceId, serviceId: deal.serviceId },
          closedDate!,
        );
      }
      // Re-opening a won row MUST reverse its daily close — the same reversal
      // the Marketing status route performs. Leaving it behind strands a
      // LeadPulseDailyClose that keeps counting in the forecast "Actual" for a
      // deal that is open again, and the stale dailyCloseId then trips the
      // guard above so the eventual real enrollment never logs its own close.
      let clearDailyClose = false;
      if (status !== "closed_won" && exists.dailyCloseId) {
        const close = await tx.leadPulseDailyClose.findUnique({
          where: { id: exists.dailyCloseId },
          select: { id: true, entry: { select: { id: true, closedWon: true } } },
        });
        if (close) {
          await tx.leadPulseDailyClose.delete({ where: { id: close.id } });
          await tx.leadPulseDailyEntry.update({
            where: { id: close.entry.id },
            data: { closedWon: Math.max(0, (close.entry.closedWon ?? 0) - 1) },
          });
        }
        clearDailyClose = true;
      }
      await tx.leadPulsePipeline.update({
        where: { id: lead.pipelineId },
        // dailyCloseId is only ever nulled alongside the reversal above — never
        // blindly, which would orphan the close instead of removing it.
        data: {
          ...base,
          closedDate,
          ...(dailyCloseId ? { dailyCloseId } : {}),
          ...(clearDailyClose ? { dailyCloseId: null } : {}),
        },
      });
      return lead.pipelineId;
    }
  }
  const closedDate = status === "closed_won" ? closedDateOverride ?? new Date() : null;
  // Brand-new row: no prior state to guard against, so a won row always logs its close.
  const dailyCloseId =
    status === "closed_won"
      ? await syncDailyClose(
          tx,
          { userId: deal.ownerUserId, sourceId: deal.sourceId, serviceId: deal.serviceId },
          closedDate!,
        )
      : undefined;
  const created = await tx.leadPulsePipeline.create({
    data: { ...base, closedDate, dailyCloseId },
  });
  return created.id;
}

/** Find a candidate Party by explicit link → email → phone → name, else create one. */
async function findOrCreateParty(tx: Prisma.TransactionClient, lead: LeadCore, ownerUserId: string): Promise<string> {
  let found: { id: string } | null = null;
  // An explicit partyId (e.g. a re-enrollment lead pre-linked to the candidate)
  // is authoritative — it pins the second service to the intended candidate even
  // when email/phone are absent or ambiguous.
  if (lead.partyId) found = await tx.party.findUnique({ where: { id: lead.partyId }, select: { id: true } });
  // Email/phone/name lookups MUST stay within group "Candidate": the Party master
  // also holds Vendors, and email/phone are non-unique, so a candidate that shares a
  // contact value with a vendor would otherwise resolve to (and mutate) the vendor row.
  if (!found && lead.email) found = await tx.party.findFirst({ where: { email: lead.email, group: "Candidate" }, select: { id: true } });
  if (!found && lead.phone) found = await tx.party.findFirst({ where: { phone: lead.phone, group: "Candidate" }, select: { id: true } });
  if (!found) found = await tx.party.findFirst({ where: { name: lead.candidateName, group: "Candidate" }, select: { id: true } });

  if (found) {
    await tx.party.update({
      where: { id: found.id },
      data: {
        email: lead.email ?? undefined,
        phone: lead.phone ?? undefined,
        sourceId: lead.sourceId ?? undefined,
        assignedL2BdeId: ownerUserId,
        isActive: true,
      },
    });
    return found.id;
  }
  const created = await tx.party.create({
    data: {
      name: lead.candidateName,
      group: "Candidate",
      email: lead.email,
      phone: lead.phone,
      sourceId: lead.sourceId,
      assignedL2BdeId: ownerUserId,
      isActive: true,
    },
  });
  return created.id;
}

/**
 * Mirror a CRM lead's status onto its Marketing pipeline row. CRM is the source
 * of truth for a deal, so a lead the consultant marked lost must not keep
 * sitting in the L2 forecast as an open deal expected to close, and reviving
 * that lead must put its deal back in the forecast.
 *
 * Deliberately never touches a `closed_won` row: an enrollment is only ever
 * un-done by Enroll / Set deal (which reverse the daily close properly), not by
 * a status edit. Best-effort — a mirror failure must not fail the status change
 * the consultant actually asked for.
 */
export async function syncPipelineToLeadStatus(args: { leadId: string; toCode: string }): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: args.leadId },
      select: { pipeline: { select: { id: true, status: true } } },
    });
    const pipeline = lead?.pipeline;
    if (!pipeline) return;

    if (isLostStatusCode(args.toCode)) {
      if (pipeline.status === "open") {
        await prisma.leadPulsePipeline.update({
          where: { id: pipeline.id },
          data: { status: "lost", closedDate: toPrismaDate(todayIst()) },
        });
      }
    } else if (pipeline.status === "lost") {
      await prisma.leadPulsePipeline.update({
        where: { id: pipeline.id },
        data: { status: "open", closedDate: null },
      });
    }
  } catch {
    // Mirror is best-effort; the lead's own status change already committed.
  }
}

type DealArgs = {
  leadId: string;
  serviceId?: string | null;
  expectedValue: number;
  expectedCloseDate: Date;
  ownerUserId?: string | null;
  actorId: string;
};

/** Set/update a lead's deal → upsert an OPEN pipeline entry (forecast). */
export async function applyLeadDeal(args: DealArgs): Promise<{ pipelineId: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: args.leadId },
    select: { ...leadCoreSelect, status: { select: { code: true, label: true } } },
  });
  if (!lead) throw new HttpError(404, "Lead not found", "not_found");

  const serviceId = args.serviceId ?? lead.serviceId;
  if (!serviceId) throw badRequest("Pick a service for the deal.", "service_required");
  if (!lead.sourceId) throw badRequest("Set the lead's source before adding a deal.", "source_required");
  if (!(args.expectedValue > 0)) throw badRequest("Enter an expected value.", "value_required");
  const ownerUserId = await resolvePipelineOwner(lead, args.ownerUserId);
  if (!ownerUserId) throw badRequest("Choose an L2 BDE as the deal owner.", "l2_owner_required");

  const deal = { serviceId, sourceId: lead.sourceId, ownerUserId, expectedValue: args.expectedValue, expectedCloseDate: args.expectedCloseDate };

  // Setting a deal moves the lead to the action-only "Pipeline" stage — unless
  // it's already enrolled (a won lead must not be downgraded).
  const alreadyEnrolled = lead.status.code === "enrolled";
  const pipelineStatus = alreadyEnrolled
    ? null
    : await prisma.crmLeadStatus.findFirst({ where: { code: "pipeline", active: true }, select: { id: true } });
  const movedToPipeline = !!pipelineStatus && lead.status.code !== "pipeline";

  const pipelineId = await prisma.$transaction(async (tx) => {
    // Editing the deal on an already-enrolled lead must keep its pipeline
    // closed_won — re-opening it would silently drop the enrollment from the
    // CRM actuals. Non-enrolled leads get/keep an open (forecast) entry.
    const pid = await upsertPipeline(tx, lead, deal, alreadyEnrolled ? "closed_won" : "open", lead.partyId);
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        serviceId,
        expectedValue: args.expectedValue,
        expectedCloseDate: args.expectedCloseDate,
        pipelineId: pid,
        ...(pipelineStatus ? { statusId: pipelineStatus.id } : {}),
      },
    });
    return pid;
  });

  await recordLeadActivity({
    leadId: lead.id,
    actorId: args.actorId,
    type: "DEAL_UPDATED",
    summary: `Deal set — expected ₹${args.expectedValue.toLocaleString("en-IN")} by ${args.expectedCloseDate.toISOString().slice(0, 10)}`,
    metadata: { serviceId, expectedValue: args.expectedValue, expectedCloseDate: args.expectedCloseDate, ownerUserId, pipelineId },
  });
  if (movedToPipeline) {
    await recordLeadActivity({
      leadId: lead.id,
      actorId: args.actorId,
      type: "STATUS_CHANGED",
      summary: `Status changed: ${lead.status.label} → Pipeline`,
      metadata: { to: "pipeline" },
    });
  }

  return { pipelineId };
}

type EnrollArgs = {
  leadId: string;
  serviceId?: string | null;
  expectedValue?: number | null;
  expectedCloseDate?: Date | null;
  // The actual enrollment date. Drives the pipeline's `closedDate` — i.e. which
  // month the enrollment counts in across every CRM metric. Defaults to now
  // when omitted (e.g. an older client that doesn't send it).
  closedDate?: Date | null;
  ownerUserId?: string | null;
  actorId: string;
};

/** Enroll: status → Enrolled, create/link the candidate (Party) for Finance,
 *  and flip the pipeline to closed_won. Returns the linked party + pipeline. */
export async function enrollLead(
  args: EnrollArgs,
): Promise<{ partyId: string; pipelineId: string; draftId: string | null; opsProjectId: string | null }> {
  const lead = await prisma.lead.findUnique({
    where: { id: args.leadId },
    select: {
      ...leadCoreSelect,
      status: { select: { label: true, code: true } },
      expectedValue: true,
      expectedCloseDate: true,
    },
  });
  if (!lead) throw new HttpError(404, "Lead not found", "not_found");

  // Idempotency: enrolling twice must never draft revenue twice. A repeat call
  // (a double-click/two-tab race, or a stale UI that still shows the Enroll
  // button) is rejected rather than silently re-drafted.
  if (lead.status.code === "enrolled") {
    throw badRequest("This lead is already enrolled.", "already_enrolled");
  }

  const serviceId = args.serviceId ?? lead.serviceId;
  const expectedValue = args.expectedValue ?? (lead.expectedValue ? Number(lead.expectedValue) : null);
  const expectedCloseDate = args.expectedCloseDate ?? lead.expectedCloseDate ?? new Date();

  if (!serviceId) throw badRequest("Pick the enrolled service.", "service_required");
  if (!lead.sourceId) throw badRequest("Set the lead's source before enrolling.", "source_required");
  if (!expectedValue || !(expectedValue > 0)) throw badRequest("Enter the deal value.", "value_required");
  const ownerUserId = await resolvePipelineOwner(lead, args.ownerUserId);
  if (!ownerUserId) throw badRequest("Choose an L2 BDE as the deal owner.", "l2_owner_required");

  const enrolled = await prisma.crmLeadStatus.findFirst({ where: { code: "enrolled", active: true }, select: { id: true } });
  if (!enrolled) throw badRequest("No active 'Enrolled' status configured — run db:seed-crm.", "no_enrolled_status");

  // Revenue draft target: the lone draft-first reviewer (Ganga). Resolved up
  // front (read-only) so the draft is created atomically with the enrollment.
  const reviewer = await prisma.user.findFirst({ where: { draftFirst: true }, select: { id: true, username: true } });
  const classification = await resolveRevenueClassification(serviceId);
  // Service name for the draft description (helps Finance tell apart a
  // candidate's multiple services / re-enrollments in their review queue).
  const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { name: true } });
  const draftDate = new Date();

  // Operations: resolve the service's active process template (+ holiday
  // calendar and default assignee) up front, read-only — like the reviewer
  // above — so the project is built atomically inside the enroll transaction.
  // A missing template is a soft no-op: enrollment must never fail because
  // Operations hasn't authored the process yet.
  const opsTemplate = await getActiveTemplateForService(prisma, serviceId);
  const opsHolidays = opsTemplate ? await loadHolidaySet(prisma) : new Set<string>();
  const opsAssigneeId = opsTemplate ? await resolveDefaultOpsAssignee(prisma) : null;

  const deal = { serviceId, sourceId: lead.sourceId, ownerUserId, expectedValue, expectedCloseDate };

  const result = await prisma.$transaction(async (tx) => {
    const partyId = await findOrCreateParty(tx, lead, ownerUserId);
    const partyService = await tx.partyService.upsert({
      where: { partyId_serviceId: { partyId, serviceId } },
      create: { partyId, serviceId, totalAmount: expectedValue },
      update: { totalAmount: expectedValue },
      select: { id: true },
    });
    // Repeat business: the candidate already holds another (different) service —
    // this enrollment is a re-enrollment. Drives the finance draft wording.
    const priorServices = await tx.partyService.count({ where: { partyId, serviceId: { not: serviceId } } });
    const isRepeat = priorServices > 0;
    const pipelineId = await upsertPipeline(tx, lead, deal, "closed_won", partyId, args.closedDate ?? null);
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        statusId: enrolled.id,
        partyId,
        pipelineId,
        serviceId,
        expectedValue,
        expectedCloseDate,
      },
    });
    // Hand the enrolled value to Finance as a Revenue draft in the reviewer's
    // (Ganga's) My-Drafts queue. She completes the classification + EXP/DOM and
    // submits it to the approval queue for the finance manager (Vishnu).
    let draftId: string | null = null;
    if (reviewer) {
      const draft = await tx.transactionDraft.create({
        data: {
          submittedById: reviewer.id,
          date: draftDate,
          month: monthCodeFromDate(draftDate),
          type: "Revenue",
          category: classification.category,
          subItem: classification.subItem,
          description: `${isRepeat ? "Re-enrollment" : "Enrollment"} — ${lead.candidateName}${service?.name ? ` · ${service.name}` : ""} (review & complete)`,
          paymentMode: "HDFC Bank",
          amount: expectedValue,
          flow: flowFor("Revenue"),
          partyId,
          expDom: null,
        },
      });
      draftId = draft.id;
    }

    // Auto-create the operations project + tasks for this enrollment. Inside
    // the transaction so a candidate is never enrolled without their project;
    // idempotent on partyServiceId and a soft no-op when no template exists.
    const opsProject = await createProjectForEnrollment(tx, {
      partyServiceId: partyService.id,
      partyId,
      serviceId,
      leadId: lead.id,
      actorId: args.actorId,
      template: opsTemplate,
      holidays: opsHolidays,
      assigneeId: opsAssigneeId,
    });

    return {
      partyId,
      pipelineId,
      draftId,
      opsProjectId: opsProject?.projectId ?? null,
      opsCreated: opsProject?.created ?? false,
      opsTaskCount: opsProject?.taskCount ?? 0,
    };
  });

  await recordLeadActivity({
    leadId: lead.id,
    actorId: args.actorId,
    type: "STATUS_CHANGED",
    summary: `Status changed: ${lead.status.label} → Enrolled`,
    metadata: { to: "enrolled" },
  });
  await recordLeadActivity({
    leadId: lead.id,
    actorId: args.actorId,
    type: "PARTY_LINKED",
    summary: "Linked to the Candidate Master (Finance can now transact)",
    metadata: { partyId: result.partyId },
  });
  await recordLeadActivity({
    leadId: lead.id,
    actorId: args.actorId,
    type: "ENROLLED",
    summary: `Enrolled — ₹${expectedValue.toLocaleString("en-IN")}`,
    metadata: { partyId: result.partyId, pipelineId: result.pipelineId, expectedValue, serviceId },
  });
  await recordLeadActivity({
    leadId: lead.id,
    actorId: args.actorId,
    type: "REVENUE_DRAFTED",
    summary: result.draftId
      ? `Revenue draft ₹${expectedValue.toLocaleString("en-IN")} sent to ${reviewer?.username ?? "finance"} for review & approval`
      : `Enrolled value ₹${expectedValue.toLocaleString("en-IN")} — no draft-review user configured; record the revenue transaction manually.`,
    metadata: { draftId: result.draftId, amount: expectedValue, partyId: result.partyId, serviceId },
  });

  // Operations handoff — surface the project on the lead timeline AND on the
  // project's own timeline. Only on first creation (re-enroll is a no-op).
  if (result.opsCreated && result.opsProjectId) {
    await recordLeadActivity({
      leadId: lead.id,
      actorId: args.actorId,
      type: "OPS_PROJECT_CREATED",
      summary: `Operations project created — ${result.opsTaskCount} step${result.opsTaskCount === 1 ? "" : "s"}`,
      metadata: { opsProjectId: result.opsProjectId, taskCount: result.opsTaskCount, serviceId },
    });
    await recordOpsActivity({
      projectId: result.opsProjectId,
      actorId: args.actorId,
      type: "PROJECT_CREATED",
      summary: `Project created on enrollment — ${result.opsTaskCount} step${result.opsTaskCount === 1 ? "" : "s"}`,
      metadata: { leadId: lead.id, serviceId, taskCount: result.opsTaskCount },
    });
  }

  return result;
}
