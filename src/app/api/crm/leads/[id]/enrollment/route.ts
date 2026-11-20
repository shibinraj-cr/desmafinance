import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { forbidden, notFound, unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canEditLead, getCrmAccess } from "@/lib/crm-rbac";
import { EnrollConfirmSchema } from "@/lib/crm-enroll-confirm";
import { editEnrollmentByBde } from "@/lib/crm-enrollment";

export const dynamic = "force-dynamic";

// PATCH /api/crm/leads/[id]/enrollment — the BDE fixes their enrollment while
// Finance hasn't verified it: before Finance looks, after Finance sent it back,
// or after Finance found no money. It goes back to Finance as pending.
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  const lead = await prisma.lead.findUnique({ where: { id: params.id }, select: { id: true, assignedToId: true } });
  if (!lead) throw notFound();
  if (!canEditLead(access, lead, userId)) throw forbidden();
  const confirm = EnrollConfirmSchema.parse(await req.json().catch(() => null));
  const result = await editEnrollmentByBde({ leadId: lead.id, actorId: userId, canBackdate: access.canUnenroll, confirm });
  return NextResponse.json(result);
});
