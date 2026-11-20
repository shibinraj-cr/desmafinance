import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, unprocessable } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { enrollLead, findCandidateParty } from "@/lib/crm-enroll";
import { EnrollConfirmSchema } from "@/lib/crm-enroll-confirm";
import { recordLeadActivity } from "@/lib/crm-activity";
import { QualityInputSchema, resolveQualityChange } from "@/lib/crm-lead-quality-data";
import { QUALITY_GATE_MESSAGE, QUALITY_REQUIRED_CODE, qualityGate } from "@/lib/crm-lead-quality";

export const dynamic = "force-dynamic";

// POST /api/crm/leads/[id]/enroll — mark Enrolled: create/link the candidate in
// the Party master (Finance can transact) + flip the pipeline to closed_won.
// Deal fields are optional here — they fall back to whatever's on the lead.
const Schema = z.object({
  serviceId: z.string().optional().nullable(),
  expectedValue: z.coerce.number().positive().optional().nullable(),
  expectedCloseDate: z.coerce.date().optional().nullable(),
  // Actual enrollment date — the date this close counts against in the CRM
  // metrics. Optional; defaults to now server-side when absent.
  closedDate: z.coerce.date().optional().nullable(),
  ownerUserId: z.string().optional().nullable(),
  // Enrolling closes the lead, so an unrated one is rated in the same step
  // (see qualityGate in crm-lead-quality.ts).
  quality: QualityInputSchema.optional(),
  // The Enroll sheet (src/lib/crm-enroll-confirm.ts): passport name, where
  // they live, the total, the first payment and the balance plan. Older
  // clients don't send it; their enrollment waits for Finance without payment
  // details.
  confirm: EnrollConfirmSchema.optional().nullable(),
});

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      assignedToId: true,
      qualityRating: true,
      qualityReasonId: true,
      qualityNote: true,
      qualityDueAt: true,
      status: { select: { code: true } },
    },
  });
  if (!lead) throw notFound();
  if (!canEditLead(access, lead, userId)) throw forbidden();

  const d = Schema.parse(await req.json().catch(() => null));

  const qualityChange = d.quality ? await resolveQualityChange(lead, d.quality, userId) : null;
  const gate = qualityGate(
    {
      qualityRating: qualityChange?.data.qualityRating ?? lead.qualityRating,
      qualityDueAt: lead.qualityDueAt,
      assignedToId: lead.assignedToId,
      statusCode: lead.status.code,
    },
    { actorId: userId, now: new Date(), nextStage: { code: "enrolled", kind: "won" } },
  );
  if (gate) throw unprocessable(QUALITY_GATE_MESSAGE[gate], QUALITY_REQUIRED_CODE);
  // Saved ahead of the enrollment: a rating is true on its own, so an enroll
  // refused for a missing source doesn't lose it.
  if (qualityChange) {
    await prisma.lead.update({ where: { id: lead.id }, data: qualityChange.data });
    await recordLeadActivity({
      leadId: lead.id,
      actorId: userId,
      type: "QUALITY_RATED",
      summary: qualityChange.summary,
      metadata: qualityChange.metadata,
    });
  }

  const result = await enrollLead({
    leadId: params.id,
    serviceId: d.serviceId ?? undefined,
    expectedValue: d.expectedValue ?? undefined,
    expectedCloseDate: d.expectedCloseDate ?? undefined,
    closedDate: d.closedDate ?? undefined,
    ownerUserId: d.ownerUserId ?? undefined,
    actorId: userId,
    // Whoever may reverse an enrollment may also date one in an earlier month.
    canBackdate: access.canUnenroll,
    confirm: d.confirm ?? null,
  });
  return NextResponse.json(result);
});

// GET — what the Enroll sheet shows before submitting: the candidate record
// this lead will be linked to (and why), so "same name, different person" is
// caught before it happens, and that candidate's billing details to prefill.
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedToId: true, partyId: true, email: true, phone: true, candidateName: true },
  });
  if (!lead) throw notFound();
  if (!canEditLead(access, lead, userId)) throw forbidden();
  const match = await findCandidateParty(prisma, lead);
  const party = match
    ? await prisma.party.findUnique({
        where: { id: match.id },
        select: {
          name: true,
          email: true,
          phone: true,
          billingName: true,
          billingAddress: true,
          billingPin: true,
          billingState: true,
          billingCountry: true,
          partyServices: { select: { service: { select: { name: true } } } },
        },
      })
    : null;
  // Enough to recognise the person, not to look anyone up: a BDE could rename
  // their own lead to probe the candidate master, so the phone is masked, the
  // email left out, and on a name-only match nothing else is shown at all.
  const strong = !!match && match.by !== "name";
  return NextResponse.json({
    match:
      match && party
        ? {
            by: match.by,
            name: party.name,
            phone: party.phone ? `••••${party.phone.replace(/\D/g, "").slice(-4)}` : null,
            services: strong ? party.partyServices.map((s) => s.service.name) : [],
          }
        : null,
    billing: party && strong
      ? {
          name: party.billingName,
          address: party.billingAddress,
          pin: party.billingPin,
          state: party.billingState,
          country: party.billingCountry,
        }
      : null,
  });
});
