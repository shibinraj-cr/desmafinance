import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { enrollLead } from "@/lib/crm-enroll";

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
});

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);

  const lead = await prisma.lead.findUnique({ where: { id: params.id }, select: { id: true, assignedToId: true } });
  if (!lead) throw notFound();
  if (!canEditLead(access, lead, userId)) throw forbidden();

  const d = Schema.parse(await req.json().catch(() => null));
  const result = await enrollLead({
    leadId: params.id,
    serviceId: d.serviceId ?? undefined,
    expectedValue: d.expectedValue ?? undefined,
    expectedCloseDate: d.expectedCloseDate ?? undefined,
    closedDate: d.closedDate ?? undefined,
    ownerUserId: d.ownerUserId ?? undefined,
    actorId: userId,
  });
  return NextResponse.json(result);
});
