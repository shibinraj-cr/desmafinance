// Re-enrollment core — REOPEN an existing candidate for a FURTHER service.
//
// A re-enrollment is a normal sales motion, not an instant close: the candidate
// (whose first service is done) comes back interested, the consultant FOLLOWS UP,
// and only when that closes does it become an enrollment. So this doesn't enroll
// anything — it opens a fresh Follow-up lead for the second service, which the
// consultant then works and enrolls through the usual Set-deal → Enroll flow
// (that's where the PartyService / closed-won pipeline / revenue draft / ops
// project get created — see enrollLead).
//
// Why a NEW lead (not the existing enrolled one): a Lead is permanently
// single-service and the candidate's existing lead is closed_won for service A.
// Reopening/enrolling that lead would overwrite service A's pipeline+enrollment
// with service B and destroy A's record/count. The second service must be its
// own lead — created here, bypassing the create-lead re-inquiry dedup, pre-linked
// to the same Party.
//
// Source handling: the new lead's PRIMARY source is stamped "Existing Candidate"
// (so repeat business is its own bucket in the source funnel) while
// `originalSourceId` preserves the channel the candidate first came in through.
//
// This is the shared core behind POST /api/crm/leads/[id]/reenroll. It is kept
// framework-free (no auth / HTTP) so it can be driven directly by verification
// scripts and tests. The route layer does auth + capability checks, then calls
// this with the resolved intent.
import { prisma } from "./prisma";
import { badRequest, notFound } from "./http-error";
import { recordLeadActivity } from "./crm-activity";
import { resolveDefaultStatus, isActiveBde } from "./crm-leads";
import { LOST_STATUS_CODES } from "./crm-reinquiry";

// The lead is reopened into this stage (an active follow-up the consultant works).
const FOLLOW_UP_STATUS_CODE = "follow_up";

export type ReopenServiceParams = {
  /** The candidate's existing lead — the identity/Party we clone + link to. */
  sourceLeadId: string;
  serviceId: string;
  /** Preserved original acquisition source; defaults to the candidate's current source. */
  originalSourceId?: string | null;
  actorId: string;
  /** Assignment policy from the caller's CRM access. */
  canAssign: boolean;
  /** Assignee requested by a CRM admin (ignored for plain BDEs → they self-own). */
  requestedAssigneeId?: string | null;
};

export type ReopenServiceResult = {
  /** The new Follow-up lead for the second service. */
  leadId: string;
  /** The follow-up task raised on it (so it doesn't slip). */
  taskId: string | null;
  /** Whether it landed in Follow-up (false → fell back to the default status). */
  followUp: boolean;
};

export async function reopenForAnotherService(p: ReopenServiceParams): Promise<ReopenServiceResult> {
  const src = await prisma.lead.findUnique({
    where: { id: p.sourceLeadId },
    select: {
      id: true,
      candidateName: true,
      email: true,
      phone: true,
      phoneE164: true,
      altPhone: true,
      altPhoneE164: true,
      emailKey: true,
      dedupeKey: true,
      sourceId: true,
      qualificationId: true,
      dob: true,
      country: true,
      studyDestination: true,
      partyId: true,
      assignedToId: true,
    },
  });
  if (!src) throw notFound();

  const service = await prisma.service.findFirst({
    where: { id: p.serviceId, isActive: true },
    select: { id: true, name: true },
  });
  if (!service) throw badRequest("Unknown or inactive service.", "invalid_service");

  if (src.partyId) {
    // Already ENROLLED in this exact service → a follow-up would be pointless
    // (and enrolling later would double-count). A different service is the point.
    const already = await prisma.partyService.findUnique({
      where: { partyId_serviceId: { partyId: src.partyId, serviceId: service.id } },
      select: { id: true },
    });
    if (already) {
      throw badRequest(`This candidate is already enrolled in ${service.name}. Pick a different service.`, "already_enrolled_service");
    }
    // Already has an OPEN (non-lost, non-enrolled) lead for this service → don't
    // spin up a duplicate follow-up; the consultant should continue that one.
    const openDup = await prisma.lead.findFirst({
      where: { partyId: src.partyId, serviceId: service.id, status: { code: { notIn: ["enrolled", ...LOST_STATUS_CODES] } } },
      select: { id: true },
    });
    if (openDup) {
      throw badRequest(`There's already an open ${service.name} lead for this candidate — continue that one.`, "open_lead_exists");
    }
  }

  // Primary source for the new lead — "Existing Candidate" (upsert-ensured so the
  // flow works in any environment even if the source master wasn't seeded).
  const existingCandidateSource = await prisma.leadPulseSource.upsert({
    where: { code: "existing_candidate" },
    update: {},
    create: { code: "existing_candidate", label: "Existing Candidate", displayOrder: 9, active: true },
    select: { id: true },
  });

  // Preserved original source: caller's choice, else the candidate's current
  // source. Validate an explicit id exists.
  const originalSourceId = p.originalSourceId ?? src.sourceId ?? null;
  if (p.originalSourceId) {
    const ok = await prisma.leadPulseSource.findUnique({ where: { id: p.originalSourceId }, select: { id: true } });
    if (!ok) throw badRequest("Unknown original source.", "invalid_original_source");
  }

  // Assignment: a CRM admin may assign to any active BDE (default: keep the
  // candidate's current consultant, else leave unassigned — never the admin, who
  // may not be a BDE); a BDE owns the lead they create.
  let assignedToId: string | null = null;
  if (p.canAssign) {
    assignedToId = p.requestedAssigneeId ?? src.assignedToId ?? null;
    if (assignedToId && !(await isActiveBde(assignedToId))) {
      throw badRequest("Assignee must be an active L1/L2 BDE.", "invalid_assignee");
    }
  } else {
    assignedToId = p.actorId; // isBde (guaranteed by the route's canCreateLeads gate)
  }

  // Reopen into Follow-up so it lands in the consultant's active queue; fall back
  // to the default status if Follow-up isn't configured.
  const followUp = await prisma.crmLeadStatus.findFirst({ where: { code: FOLLOW_UP_STATUS_CODE, active: true }, select: { id: true } });
  const statusId = followUp?.id ?? (await resolveDefaultStatus())?.id;
  if (!statusId) throw badRequest("No lead statuses configured — run db:seed-crm.", "no_status_configured");

  // Create the second-service lead in Follow-up: same identity, pre-linked to the
  // candidate, primary source "Existing Candidate", original source preserved. No
  // deal/enrollment yet — the consultant works it and enrolls when it closes.
  // Copy the already-normalised dedup keys verbatim so its contact identity matches.
  const created = await prisma.lead.create({
    data: {
      candidateName: src.candidateName,
      email: src.email,
      phone: src.phone,
      phoneE164: src.phoneE164,
      altPhone: src.altPhone,
      altPhoneE164: src.altPhoneE164,
      emailKey: src.emailKey,
      dedupeKey: src.dedupeKey,
      sourceId: existingCandidateSource.id,
      originalSourceId,
      serviceId: service.id,
      qualificationId: src.qualificationId,
      statusId,
      assignedToId,
      assignedAt: assignedToId ? new Date() : null,
      dob: src.dob,
      country: src.country,
      studyDestination: src.studyDestination,
      partyId: src.partyId ?? null,
      createdById: p.actorId,
      extra: { reEnrollment: "true", reEnrolledFromLeadId: src.id },
    },
    select: { id: true },
  });

  await recordLeadActivity({
    leadId: created.id,
    actorId: p.actorId,
    type: "LEAD_CREATED",
    summary: `Re-enrollment follow-up — existing candidate interested in ${service.name}`,
    metadata: { reEnrolledFromLeadId: src.id, serviceId: service.id, originalSourceId },
  });

  // Raise a follow-up task so the re-engagement doesn't slip (mirrors the
  // re-inquiry task). Owned by the new lead's consultant.
  const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const subject = `Follow up — ${src.candidateName} for ${service.name} (re-enrollment)`;
  const task = await prisma.crmTask.create({
    data: {
      leadId: created.id,
      subject,
      priority: "high",
      status: "open",
      dueAt,
      assignedToId,
      createdById: p.actorId,
      note: `Existing candidate re-engaged for ${service.name}. Work the follow-up and Enroll when it closes.`,
    },
    select: { id: true },
  });
  await recordLeadActivity({
    leadId: created.id,
    actorId: p.actorId,
    type: "TASK_CREATED",
    summary: `Task created: ${subject}`,
    metadata: { taskId: task.id, source: "reenrollment" },
  });

  return { leadId: created.id, taskId: task.id, followUp: !!followUp };
}
