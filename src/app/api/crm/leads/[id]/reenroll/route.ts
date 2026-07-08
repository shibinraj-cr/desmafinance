import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { reEnrollCandidate } from "@/lib/crm-reenroll";

export const dynamic = "force-dynamic";

// POST /api/crm/leads/[id]/reenroll — enroll an EXISTING candidate in a further
// service. `[id]` is the candidate's current (typically already-enrolled) lead.
//
// A thin wrapper: authenticate, gate on the ability to create leads (any BDE or
// CRM admin — NOT restricted to the candidate's original consultant), then hand
// the resolved intent to reEnrollCandidate() which does the create + enroll. See
// src/lib/crm-reenroll.ts for the mechanics and the source-attribution rationale.
const Schema = z.object({
  serviceId: z.string().min(1),
  expectedValue: z.coerce.number().positive(),
  // The enrollment date — the month this close counts against; defaults to now.
  closedDate: z.coerce.date().optional().nullable(),
  // Preserved original acquisition source; defaults to the candidate's current source.
  originalSourceId: z.string().optional().nullable(),
  // L2 pipeline owner; defaults to the previous enrollment's owner.
  ownerUserId: z.string().optional().nullable(),
  // CRM admins may assign the new lead; ignored for BDEs (who own their own).
  assignedToId: z.string().optional().nullable(),
});

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canCreateLeads) throw forbidden();

  const d = Schema.parse(await req.json().catch(() => null));
  const result = await reEnrollCandidate({
    sourceLeadId: params.id,
    serviceId: d.serviceId,
    expectedValue: d.expectedValue,
    closedDate: d.closedDate ?? undefined,
    originalSourceId: d.originalSourceId ?? undefined,
    ownerUserId: d.ownerUserId ?? undefined,
    actorId: userId,
    canAssign: access.canAssign,
    requestedAssigneeId: d.assignedToId ?? undefined,
  });
  return NextResponse.json(result, { status: 201 });
});
