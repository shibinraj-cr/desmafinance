import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { recordLeadActivity } from "@/lib/crm-activity";
import { notifyLeadAssigned } from "@/lib/crm-notify";
import { leadRowInclude, serializeLead, crmTaskFollowAssignmentWhere } from "@/lib/crm-leads";

export const dynamic = "force-dynamic";

const AssignSchema = z.object({
  assignedToId: z.string().nullable(),
});

// POST /api/crm/leads/[id]/assign — assign / reassign (admin only)
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canAssign) throw forbidden();

  const body = await req.json().catch(() => null);
  const { assignedToId } = AssignSchema.parse(body);
  const target = assignedToId || null;

  const existing = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedToId: true, assignedTo: { select: { username: true } } },
  });
  if (!existing) throw notFound();

  // Validate the new assignee is an active L1/L2 BDE (matches the dropdown).
  let targetName: string | null = null;
  if (target) {
    const role = await prisma.leadPulseRole.findUnique({
      where: { userId: target },
      select: { role: true, active: true, displayName: true },
    });
    if (!role || !role.active || (role.role !== "l1" && role.role !== "l2")) {
      throw badRequest("Assignee must be an active L1/L2 BDE", "invalid_assignee");
    }
    targetName = role.displayName;
  }

  if (existing.assignedToId === target) {
    // Assignee unchanged, but still pull any OPEN tasks stranded as "Unassigned"
    // onto the current owner so the Tasks board's "Unassigned" filter stays in
    // sync (repairs tasks stamped null before a consultant existed).
    if (target) {
      await prisma.crmTask.updateMany({
        where: { leadId: params.id, status: "open", ...crmTaskFollowAssignmentWhere(null) },
        data: { assignedToId: target },
      });
    }
    const unchanged = await prisma.lead.findUnique({ where: { id: params.id }, include: leadRowInclude });
    return NextResponse.json({ lead: serializeLead(unchanged!) });
  }

  // Propagate the (re)assignment to the lead's OPEN tasks so the Tasks board's
  // "Unassigned" filter and consultant column track the lead owner.
  const updated = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.update({
      where: { id: params.id },
      // Stamp the assignment moment (cleared on unassign) so the list can show an
      // "Assigned" date and filter by it.
      data: { assignedToId: target, assignedAt: target ? new Date() : null },
      include: leadRowInclude,
    });
    await tx.crmTask.updateMany({
      where: { leadId: params.id, status: "open", ...crmTaskFollowAssignmentWhere(existing.assignedToId) },
      data: { assignedToId: target },
    });
    return lead;
  });

  const wasAssigned = !!existing.assignedToId;
  // Type is chosen by the resulting state, not just the prior one, so an
  // unassign is never mis-logged as a reassignment in the History tab.
  const type = !target ? "UNASSIGNED" : wasAssigned ? "REASSIGNED" : "ASSIGNED";
  const summary = !target
    ? `Unassigned${existing.assignedTo ? ` from ${existing.assignedTo.username}` : ""}`
    : wasAssigned
      ? `Reassigned to ${targetName}`
      : `Assigned to ${targetName}`;

  await recordLeadActivity({
    leadId: updated.id,
    actorId: userId,
    type,
    summary,
    metadata: { fromUserId: existing.assignedToId, toUserId: target },
  });

  // In-app notify the new owner (best-effort; no-op on unassign or self-assign).
  if (target) {
    await notifyLeadAssigned({
      assigneeUserId: target,
      actorUserId: userId,
      leadId: updated.id,
      candidateName: updated.candidateName,
      isReassignment: wasAssigned,
    });
  }

  return NextResponse.json({ lead: serializeLead(updated) });
});
