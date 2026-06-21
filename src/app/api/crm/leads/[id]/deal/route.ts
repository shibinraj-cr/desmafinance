import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { applyLeadDeal } from "@/lib/crm-enroll";

export const dynamic = "force-dynamic";

// POST /api/crm/leads/[id]/deal — set/update the deal (service + expected value
// + close date). Mirrors to an OPEN Lead Pulse pipeline entry for the forecast.
const Schema = z.object({
  serviceId: z.string().optional().nullable(),
  expectedValue: z.coerce.number().positive(),
  expectedCloseDate: z.coerce.date(),
  ownerUserId: z.string().optional().nullable(),
});

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);

  const lead = await prisma.lead.findUnique({ where: { id: params.id }, select: { id: true, assignedToId: true } });
  if (!lead) throw notFound();
  if (!canEditLead(access, lead, userId)) throw forbidden();

  const d = Schema.parse(await req.json().catch(() => null));
  const result = await applyLeadDeal({
    leadId: params.id,
    serviceId: d.serviceId ?? undefined,
    expectedValue: d.expectedValue,
    expectedCloseDate: d.expectedCloseDate,
    ownerUserId: d.ownerUserId ?? undefined,
    actorId: userId,
  });
  return NextResponse.json(result);
});
