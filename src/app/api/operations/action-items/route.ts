import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, canEditProject, roleIsOpsUser } from "@/lib/ops-rbac";
import { opsActionItemInclude, serializeActionItem } from "@/lib/ops-action-items";
import { opsDateToPrisma } from "@/lib/ops-dates";
import { recordOpsActivity } from "@/lib/ops-activity";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  // The step (OpsTask) this task is attached to.
  taskId: z.string().min(1),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).nullable().optional(),
  assignedToId: z.string().min(1).nullable().optional(),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueAt must be YYYY-MM-DD").nullable().optional(),
});

/** Validate that a task's assignee is an operations user (tasks are ops-only). */
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

// POST /api/operations/action-items — add an ad-hoc task to a step. The project
// is derived from the step; the caller must be able to edit that project.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = getOpsAccess(userId, perms);
  if (!access.isOpsUser) throw forbidden();

  const d = CreateSchema.parse(await req.json().catch(() => null));

  const step = await prisma.opsTask.findUnique({
    where: { id: d.taskId },
    select: { id: true, name: true, projectId: true, project: { select: { assignedToId: true } } },
  });
  if (!step) throw notFound();
  if (!canEditProject(access, step.project, userId)) throw forbidden();

  if (d.assignedToId) await assertOpsAssignee(d.assignedToId);

  const created = await prisma.opsActionItem.create({
    data: {
      projectId: step.projectId,
      taskId: step.id,
      title: d.title,
      description: d.description ?? null,
      assignedToId: d.assignedToId ?? null,
      dueAt: d.dueAt ? opsDateToPrisma(d.dueAt) : null,
      createdById: userId,
    },
    include: opsActionItemInclude,
  });

  await recordOpsActivity({
    projectId: step.projectId,
    taskId: step.id,
    actorId: userId,
    type: "TASK_ADDED",
    summary: `Task added on "${step.name}": ${d.title}`,
    metadata: { actionItemId: created.id, assignedToId: d.assignedToId ?? null },
  });

  return NextResponse.json({ actionItem: serializeActionItem(created) }, { status: 201 });
});
