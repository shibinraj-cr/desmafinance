import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { reopenForAnotherService } from "@/lib/crm-reenroll";

export const dynamic = "force-dynamic";

// POST /api/crm/leads/[id]/reenroll — REOPEN an existing candidate for a further
// service. `[id]` is the candidate's current (typically already-enrolled) lead.
//
// This does NOT enroll: a re-enrollment is a normal follow-up motion. It opens a
// fresh Follow-up lead for the second service (+ a follow-up task), which the
// consultant works and enrolls via the usual Set-deal → Enroll flow. See
// src/lib/crm-reenroll.ts for the mechanics and the source-attribution rationale.
//
// A thin wrapper: authenticate, gate on the ability to create leads (any BDE or
// CRM admin — NOT restricted to the candidate's original consultant), then hand
// the resolved intent to reopenForAnotherService().
const Schema = z.object({
  serviceId: z.string().min(1),
  // Preserved original acquisition source; defaults to the candidate's current source.
  originalSourceId: z.string().optional().nullable(),
  // CRM admins may assign the new lead; ignored for BDEs (who own their own).
  assignedToId: z.string().optional().nullable(),
});

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canCreateLeads) throw forbidden();

  const d = Schema.parse(await req.json().catch(() => null));
  const result = await reopenForAnotherService({
    sourceLeadId: params.id,
    serviceId: d.serviceId,
    originalSourceId: d.originalSourceId ?? undefined,
    actorId: userId,
    canAssign: access.canAssign,
    requestedAssigneeId: d.assignedToId ?? undefined,
  });
  return NextResponse.json(result, { status: 201 });
});
