import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, canEditProject, roleIsOpsUser } from "@/lib/ops-rbac";
import {
  applyActionItemStatus,
  ACTION_ITEM_ACTIVITY,
  opsActionItemInclude,
  serializeActionItem,
  type ActionItemAction,
} from "@/lib/ops-action-items";
import { opsDateToPrisma } from "@/lib/ops-dates";
import { recordOpsActivity } from "@/lib/ops-activity";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const PatchSchema = z.object({
  // A status transition…
  action: z.enum(["complete", "reopen", "cancel"]).optional(),
  // …and/or field edits.
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  assignedToId: z.string().min(1).nullable().optional(),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueAt must be YYYY-MM-DD").nullable().optional(),
});

async function assertOpsAssignee(id: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id },
    select: { roleRef: { select: { isAdmin: true, pages: true } } },
  });
  if (!u) throw badRequest("Assignee not found.", "assignee_not_found");
  if (!roleIsOpsUser(u.roleRef?.isAdmin ?? false, u.roleRef?.pages ?? [])) {
    throw badRequest("Tasks can only be assigned to operations users.", "assignee_not_ops");
  }
}

// PATCH /api/operations/action-items/[id] — transition status (complete/reopen/
// cancel) and/or edit fields (title, description, assignee, due date).
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = getOpsAccess(userId, perms);

  const item = await prisma.opsActionItem.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, projectId: true, taskId: true, assignedToId: true, project: { select: { assignedToId: true } } },
  });
  if (!item) throw notFound();
  if (!canEditProject(access, item.project, userId)) throw forbidden();

  const d = PatchSchema.parse(await req.json().catch(() => null));

  const data: Record<string, unknown> = {};
  if (d.title !== undefined) data.title = d.title;
  if (d.description !== undefined) data.description = d.description;
  if (d.dueAt !== undefined) data.dueAt = d.dueAt ? opsDateToPrisma(d.dueAt) : null;

  const assigneeChanging = d.assignedToId !== undefined && d.assignedToId !== item.assignedToId;
  if (assigneeChanging) {
    if (d.assignedToId) await assertOpsAssignee(d.assignedToId);
    data.assignedToId = d.assignedToId;
  }

  const now = new Date();
  if (d.action) Object.assign(data, applyActionItemStatus(d.action as ActionItemAction, { actorId: userId, now }));

  if (Object.keys(data).length === 0) throw badRequest("Nothing to update.", "empty_patch");

  const updated = await prisma.opsActionItem.update({
    where: { id: params.id },
    data,
    include: opsActionItemInclude,
  });

  if (d.action) {
    await recordOpsActivity({
      projectId: item.projectId,
      taskId: item.taskId,
      actorId: userId,
      type: ACTION_ITEM_ACTIVITY[d.action as ActionItemAction],
      summary: `Task ${d.action === "complete" ? "completed" : d.action === "reopen" ? "reopened" : "cancelled"}: ${item.title}`,
      metadata: { actionItemId: item.id, action: d.action },
    });
  }
  if (assigneeChanging) {
    await recordOpsActivity({
      projectId: item.projectId,
      taskId: item.taskId,
      actorId: userId,
      type: "TASK_ASSIGNED",
      summary: d.assignedToId ? `Task "${item.title}" assigned to ${updated.assignedTo?.username ?? "user"}` : `Task "${item.title}" unassigned`,
      metadata: { actionItemId: item.id, assignedToId: d.assignedToId ?? null },
    });
  }

  return NextResponse.json({ actionItem: serializeActionItem(updated) });
});

// DELETE /api/operations/action-items/[id] — hard-remove a task.
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = getOpsAccess(userId, perms);

  const item = await prisma.opsActionItem.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, projectId: true, taskId: true, project: { select: { assignedToId: true } } },
  });
  if (!item) throw notFound();
  if (!canEditProject(access, item.project, userId)) throw forbidden();

  await prisma.opsActionItem.delete({ where: { id: params.id } });
  await recordOpsActivity({
    projectId: item.projectId,
    taskId: item.taskId,
    actorId: userId,
    type: "TASK_CANCELLED",
    summary: `Task removed: ${item.title}`,
    metadata: { actionItemId: item.id, deleted: true },
  });

  return NextResponse.json({ ok: true });
});
