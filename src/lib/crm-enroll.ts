// Enrollment + deal logic: mirror a lead's deal (service + expected value +
// close date) to a Lead Pulse pipeline entry (so it feeds the Marketing
// "expected to close" projection), and on enroll create/link the candidate in
// the Party master (so Finance can transact) and flip the pipeline to won.
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { badRequest, HttpError } from "./http-error";
import { recordLeadActivity } from "./crm-activity";

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

async function upsertPipeline(
  tx: Prisma.TransactionClient,
  lead: LeadCore,
  deal: { serviceId: string; sourceId: string; ownerUserId: string; expectedValue: number; expectedCloseDate: Date },
  status: "open" | "closed_won",
  partyId: string | null,
): Promise<string> {
  const data = {
    userId: deal.ownerUserId,
    candidateName: lead.candidateName,
    candidatePhone: lead.phone,
    partyId,
    serviceId: deal.serviceId,
    sourceId: deal.sourceId,
    expectedCloseDate: deal.expectedCloseDate,
    expectedFirstInstallment: deal.expectedValue,
    status,
    closedDate: status === "closed_won" ? new Date() : null,
  };
  if (lead.pipelineId) {
    const exists = await tx.leadPulsePipeline.findUnique({ where: { id: lead.pipelineId }, select: { id: true } });
    if (exists) {
      await tx.leadPulsePipeline.update({ where: { id: lead.pipelineId }, data });
      return lead.pipelineId;
    }
  }
  const created = await tx.leadPulsePipeline.create({ data });
  return created.id;
}

/** Find a candidate Party by email → phone → name, else create one. */
async function findOrCreateParty(tx: Prisma.TransactionClient, lead: LeadCore, ownerUserId: string): Promise<string> {
  let found: { id: string } | null = null;
  if (lead.email) found = await tx.party.findFirst({ where: { email: lead.email }, select: { id: true } });
  if (!found && lead.phone) found = await tx.party.findFirst({ where: { phone: lead.phone }, select: { id: true } });
  if (!found) found = await tx.party.findFirst({ where: { name: lead.candidateName }, select: { id: true } });

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
  const lead = await prisma.lead.findUnique({ where: { id: args.leadId }, select: leadCoreSelect });
  if (!lead) throw new HttpError(404, "Lead not found", "not_found");

  const serviceId = args.serviceId ?? lead.serviceId;
  if (!serviceId) throw badRequest("Pick a service for the deal.", "service_required");
  if (!lead.sourceId) throw badRequest("Set the lead's source before adding a deal.", "source_required");
  if (!(args.expectedValue > 0)) throw badRequest("Enter an expected value.", "value_required");
  const ownerUserId = await resolvePipelineOwner(lead, args.ownerUserId);
  if (!ownerUserId) throw badRequest("Choose an L2 BDE as the deal owner.", "l2_owner_required");

  const deal = { serviceId, sourceId: lead.sourceId, ownerUserId, expectedValue: args.expectedValue, expectedCloseDate: args.expectedCloseDate };

  const pipelineId = await prisma.$transaction(async (tx) => {
    const pid = await upsertPipeline(tx, lead, deal, "open", lead.partyId);
    await tx.lead.update({
      where: { id: lead.id },
      data: { serviceId, expectedValue: args.expectedValue, expectedCloseDate: args.expectedCloseDate, pipelineId: pid },
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

  return { pipelineId };
}

type EnrollArgs = {
  leadId: string;
  serviceId?: string | null;
  expectedValue?: number | null;
  expectedCloseDate?: Date | null;
  ownerUserId?: string | null;
  actorId: string;
};

/** Enroll: status → Enrolled, create/link the candidate (Party) for Finance,
 *  and flip the pipeline to closed_won. Returns the linked party + pipeline. */
export async function enrollLead(args: EnrollArgs): Promise<{ partyId: string; pipelineId: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: args.leadId },
    select: { ...leadCoreSelect, status: { select: { label: true } }, expectedValue: true, expectedCloseDate: true },
  });
  if (!lead) throw new HttpError(404, "Lead not found", "not_found");

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

  const deal = { serviceId, sourceId: lead.sourceId, ownerUserId, expectedValue, expectedCloseDate };

  const result = await prisma.$transaction(async (tx) => {
    const partyId = await findOrCreateParty(tx, lead, ownerUserId);
    await tx.partyService.upsert({
      where: { partyId_serviceId: { partyId, serviceId } },
      create: { partyId, serviceId, totalAmount: expectedValue },
      update: { totalAmount: expectedValue },
    });
    const pipelineId = await upsertPipeline(tx, lead, deal, "closed_won", partyId);
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
    return { partyId, pipelineId };
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

  return result;
}
