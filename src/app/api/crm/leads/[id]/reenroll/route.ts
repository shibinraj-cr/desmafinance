import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { recordLeadActivity } from "@/lib/crm-activity";
import { resolveDefaultStatus, isActiveBde } from "@/lib/crm-leads";
import { enrollLead, isActiveL2 } from "@/lib/crm-enroll";

export const dynamic = "force-dynamic";

// POST /api/crm/leads/[id]/reenroll — enroll an EXISTING candidate in a further
// service. `[id]` is the candidate's current (typically already-enrolled) lead.
//
// Why a dedicated route: a Lead is permanently single-service, and the normal
// create-lead API folds any same-contact submission into a re-inquiry (never a
// new row). A second service therefore needs a fresh Lead — created here,
// bypassing that dedup, pre-linked to the same Party — which is then enrolled.
// The result: same candidate, a NEW enrollment (own pipeline / revenue draft /
// ops project) that counts in every enrollment metric.
//
// Source handling: the new lead's PRIMARY source is stamped "Existing Candidate"
// (so repeat business is its own bucket in the source funnel) while
// `originalSourceId` preserves the channel the candidate first came in through.
//
// Access: any consultant who can create leads (BDE or CRM admin) — a BDE owns
// the new lead they create; a CRM admin may assign it. NOT restricted to the
// candidate's original consultant.
const Schema = z.object({
  serviceId: z.string().min(1),
  expectedValue: z.coerce.number().positive(),
  // The enrollment date — the month this close counts against in the metrics.
  // Optional; defaults to now server-side.
  closedDate: z.coerce.date().optional().nullable(),
  // Preserved original acquisition source. Defaults to the candidate's existing
  // source when omitted.
  originalSourceId: z.string().optional().nullable(),
  // L2 BDE who owns the (per-L2) pipeline. Optional — defaults to the previous
  // enrollment's owner, else the acting user when they are an active L2.
  ownerUserId: z.string().optional().nullable(),
  // CRM admins may assign the new lead; ignored for BDEs (who own their own).
  assignedToId: z.string().optional().nullable(),
});

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canCreateLeads) throw forbidden();

  // The candidate's existing lead — the template we clone identity from.
  const src = await prisma.lead.findUnique({
    where: { id: params.id },
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
      country: true,
      studyDestination: true,
      partyId: true,
      assignedToId: true,
      pipeline: { select: { userId: true } },
    },
  });
  if (!src) throw notFound();

  const d = Schema.parse(await req.json().catch(() => null));

  const service = await prisma.service.findFirst({
    where: { id: d.serviceId, isActive: true },
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
  let originalSourceId = d.originalSourceId ?? src.sourceId ?? null;
  if (d.originalSourceId) {
    const ok = await prisma.leadPulseSource.findUnique({ where: { id: d.originalSourceId }, select: { id: true } });
    if (!ok) throw badRequest("Unknown original source.", "invalid_original_source");
  }

  // Assignment: a CRM admin may assign to any active BDE (default: keep the
  // candidate's current consultant, else leave unassigned — never the admin,
  // who may not be a BDE); a BDE owns the lead they create.
  let assignedToId: string | null = null;
  if (access.canAssign) {
    assignedToId = d.assignedToId ?? src.assignedToId ?? null;
    if (assignedToId && !(await isActiveBde(assignedToId))) {
      throw badRequest("Assignee must be an active L1/L2 BDE.", "invalid_assignee");
    }
  } else {
    assignedToId = userId; // isBde (guaranteed by canCreateLeads when not an admin)
  }

  // Pipeline owner must be an active L2. Default to the previous enrollment's
  // owner (guaranteed L2). Pre-validate here so the create+enroll below can't
  // fail the owner check and leave an un-enrolled lead behind.
  const ownerUserId = d.ownerUserId ?? src.pipeline?.userId ?? null;
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
      country: src.country,
      studyDestination: src.studyDestination,
      partyId: src.partyId ?? null,
      expectedValue: d.expectedValue,
      createdById: userId,
      extra: { reEnrollment: "true", reEnrolledFromLeadId: src.id },
    },
    select: { id: true },
  });

  await recordLeadActivity({
    leadId: created.id,
    actorId: userId,
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
    expectedValue: d.expectedValue,
    closedDate: d.closedDate ?? undefined,
    ownerUserId: ownerUserId ?? undefined,
    actorId: userId,
  });

  return NextResponse.json({ leadId: created.id, ...result }, { status: 201 });
});
