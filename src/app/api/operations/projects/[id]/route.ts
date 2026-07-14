import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, canEditProject } from "@/lib/ops-rbac";
import { opsProjectDetailInclude, serializeProjectDetail } from "@/lib/ops-queries";
import { recordOpsActivity } from "@/lib/ops-activity";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export const GET = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!getOpsAccess(userId, perms).canViewProjects) throw forbidden();

  const p = await prisma.opsProject.findUnique({ where: { id: params.id }, include: opsProjectDetailInclude });
  if (!p) throw notFound();
  return NextResponse.json({ project: serializeProjectDetail(p) });
});

const PatchSchema = z.object({
  status: z.enum(["active", "on_hold", "completed", "cancelled"]).optional(),
  // assignment: a user id, or null to unassign. `undefined` = leave unchanged.
  assignedToId: z.string().min(1).nullable().optional(),
  // On reassignment, also move the outgoing owner's still-open tasks to the new
  // owner (the mid-process hand-off). Ignored unless the owner is changing.
  carryOpenTasks: z.boolean().optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = getOpsAccess(userId, perms);

  const project = await prisma.opsProject.findUnique({
    where: { id: params.id },
    select: { id: true, assignedToId: true, status: true },
  });
  if (!project) throw notFound();
  if (!canEditProject(access, project, userId)) throw forbidden();

  const d = PatchSchema.parse(await req.json().catch(() => null));

  // Reassignment is a manager-only capability.
  const changingAssignee = d.assignedToId !== undefined && d.assignedToId !== project.assignedToId;
  if (changingAssignee && !access.canAssign) throw forbidden();
  if (d.assignedToId) {
    const assignee = await prisma.user.findUnique({ where: { id: d.assignedToId }, select: { id: true } });
    if (!assignee) throw badRequest("Assignee not found.", "assignee_not_found");
  }

  const data: Record<string, unknown> = {};
  if (d.status !== undefined) {
    data.status = d.status;
    data.completedAt = d.status === "completed" ? new Date() : null;
  }
  if (d.assignedToId !== undefined) {
    data.assignedToId = d.assignedToId;
    data.assignedAt = d.assignedToId ? new Date() : null;
  }

  const updated = await prisma.opsProject.update({
    where: { id: params.id },
    data,
    include: opsProjectDetailInclude,
  });

  let carriedTasks = 0;
  if (changingAssignee) {
    const type = d.assignedToId === null ? "UNASSIGNED" : project.assignedToId ? "REASSIGNED" : "ASSIGNED";
    await recordOpsActivity({
      projectId: params.id,
      actorId: userId,
      type,
      summary: d.assignedToId ? `Assigned to ${updated.assignedTo?.username ?? "user"}` : "Unassigned",
      metadata: { assignedToId: d.assignedToId },
    });

    // Carry the outgoing owner's open tasks to the new owner, if requested.
    if (d.carryOpenTasks && project.assignedToId && d.assignedToId) {
      const res = await prisma.opsActionItem.updateMany({
        where: { projectId: params.id, assignedToId: project.assignedToId, status: "open" },
        data: { assignedToId: d.assignedToId },
      });
      carriedTasks = res.count;
      if (carriedTasks > 0) {
        await recordOpsActivity({
          projectId: params.id,
          actorId: userId,
          type: "TASK_ASSIGNED",
          summary: `${carriedTasks} open task${carriedTasks === 1 ? "" : "s"} carried to ${updated.assignedTo?.username ?? "new owner"}`,
          metadata: { carriedCount: carriedTasks, from: project.assignedToId, to: d.assignedToId },
        });
      }
    }
  }
  if (d.status !== undefined && d.status !== project.status) {
    await recordOpsActivity({
      projectId: params.id,
      actorId: userId,
      type: d.status === "completed" ? "PROJECT_COMPLETED" : "PROJECT_REOPENED",
      summary: `Project marked ${d.status}`,
      metadata: { from: project.status, to: d.status },
    });
  }

  return NextResponse.json({ project: serializeProjectDetail(updated), carriedTasks });
});
