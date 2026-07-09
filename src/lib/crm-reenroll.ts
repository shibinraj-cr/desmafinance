// Re-enrollment core — enroll an EXISTING candidate in a FURTHER service.
//
// A Lead is permanently single-service, and the normal create-lead API folds any
// same-contact submission into a re-inquiry (never a new row). A second service
// therefore needs a fresh Lead — created here, bypassing that dedup, pre-linked
// to the same Party — which is then enrolled. The result: same candidate, a NEW
// enrollment (its own pipeline / revenue draft / ops project) that counts in
// every enrollment metric.
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
import { enrollLead, isActiveL2 } from "./crm-enroll";

export type ReEnrollParams = {
  /** The candidate's existing lead — the identity/Party we clone + link to. */
  sourceLeadId: string;
  serviceId: string;
  expectedValue: number;
  /** Enrollment date (drives the metric month bucket); defaults to now. */
  closedDate?: Date | null;
  /** Preserved original acquisition source; defaults to the candidate's current source. */
  originalSourceId?: string | null;
  /** L2 pipeline owner; defaults to the previous enrollment's owner. */
  ownerUserId?: string | null;
  actorId: string;
  /** Assignment policy from the caller's CRM access. */
  canAssign: boolean;
  /** Assignee requested by a CRM admin (ignored for plain BDEs → they self-own). */
  requestedAssigneeId?: string | null;
};

export type ReEnrollResult = {
  leadId: string;
  partyId: string;
  pipelineId: string;
  draftId: string | null;
  opsProjectId: string | null;
};

export async function reEnrollCandidate(p: ReEnrollParams): Promise<ReEnrollResult> {
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
      pipeline: { select: { userId: true } },
    },
  });
  if (!src) throw notFound();

  const service = await prisma.service.findFirst({
    where: { id: p.serviceId, isActive: true },
    select: { id: true, name: true },
  });
  if (!service) throw badRequest("Unknown or inactive service.", "invalid_service");

  // Guard against a duplicate enrollment: if the candidate already holds this
  // exact service, a second lead would double-count. (A different service is the
  // whole point and is allowed.)
  if (src.partyId) {
    const already = await prisma.partyService.findUnique({
      where: { partyId_serviceId: { partyId: src.partyId, serviceId: service.id } },
      select: { id: true },
    });
    if (already) {
      throw badRequest(`This candidate is already enrolled in ${service.name}. Pick a different service.`, "already_enrolled_service");
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

  // Pipeline owner must be an active L2. Default to the previous enrollment's
  // owner (guaranteed L2). Pre-validate here so the create+enroll below can't
  // fail the owner check and leave an un-enrolled lead behind.
  const ownerUserId = p.ownerUserId ?? src.pipeline?.userId ?? null;
  const ownerResolvable =
    (assignedToId && (await isActiveL2(assignedToId))) || (ownerUserId && (await isActiveL2(ownerUserId)));
  if (!ownerResolvable) {
    throw badRequest("Choose an L2 BDE as the deal owner.", "l2_owner_required");
  }

  const def = await resolveDefaultStatus();
  if (!def) throw badRequest("No lead statuses configured — run db:seed-crm.", "no_status_configured");

  // Create the second-service lead: same identity, pre-linked to the candidate,
  // primary source "Existing Candidate", original source preserved. Copy the
  // already-normalised dedup keys verbatim so its contact identity matches.
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
      statusId: def.id,
      assignedToId,
      assignedAt: assignedToId ? new Date() : null,
      dob: src.dob,
      country: src.country,
      studyDestination: src.studyDestination,
      partyId: src.partyId ?? null,
      expectedValue: p.expectedValue,
      createdById: p.actorId,
      extra: { reEnrollment: "true", reEnrolledFromLeadId: src.id },
    },
    select: { id: true },
  });

  await recordLeadActivity({
    leadId: created.id,
    actorId: p.actorId,
    type: "LEAD_CREATED",
    summary: `Re-enrollment — existing candidate enrolling in ${service.name}`,
    metadata: { reEnrolledFromLeadId: src.id, serviceId: service.id, originalSourceId },
  });

  // Enroll the new lead → status Enrolled, second PartyService, a fresh
  // closed_won pipeline (counts in the metrics), an independent revenue draft,
  // and its own operations project. All the heavy lifting lives in enrollLead.
  const result = await enrollLead({
    leadId: created.id,
    serviceId: service.id,
    expectedValue: p.expectedValue,
    closedDate: p.closedDate ?? undefined,
    ownerUserId: ownerUserId ?? undefined,
    actorId: p.actorId,
  });

  return {
    leadId: created.id,
    partyId: result.partyId,
    pipelineId: result.pipelineId,
    draftId: result.draftId,
    opsProjectId: result.opsProjectId,
  };
}
