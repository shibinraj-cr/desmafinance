import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, canEditProject } from "@/lib/ops-rbac";
import { applyTaskTransition, deriveProjectCompleted, TASK_ACTION_ACTIVITY, type TaskAction } from "@/lib/ops-tasks";
import { recordOpsActivity } from "@/lib/ops-activity";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const PatchSchema = z.object({
  action: z.enum(["start", "complete", "block", "skip", "reopen"]),
  blockedReason: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

// PATCH /api/operations/tasks/[id] — transition a task (start/complete/block/
// skip/reopen). Stamps timestamps + completedBy, writes a project-timeline
// activity, and rolls the project status up to completed when all required
// tasks are done (or back to active when reopened).
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = getOpsAccess(userId, perms);

  const task = await prisma.opsTask.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      startedAt: true,
      name: true,
      projectId: true,
      project: { select: { id: true, assignedToId: true, status: true } },
    },
  });
  if (!task) throw notFound();
  if (!canEditProject(access, task.project, userId)) throw forbidden();

  const d = PatchSchema.parse(await req.json().catch(() => null));
  const action = d.action as TaskAction;
  if (action === "block" && !d.blockedReason) throw badRequest("A reason is required to block a step.", "reason_required");

  const now = new Date();
  const patch = applyTaskTransition({ status: task.status, startedAt: task.startedAt }, action, {
    actorId: userId,
    now,
    blockedReason: d.blockedReason ?? null,
  });

  const projectStatusChange = await prisma.$transaction(async (tx) => {
    await tx.opsTask.update({
      where: { id: params.id },
      data: { ...patch, ...(d.notes !== undefined ? { notes: d.notes } : {}) },
    });

    // Roll the project status up/down from the resulting task set.
    const siblings = await tx.opsTask.findMany({
      where: { projectId: task.projectId },
      select: { isRequired: true, status: true },
    });
    const shouldComplete = deriveProjectCompleted(siblings);
    if (shouldComplete && task.project.status !== "completed") {
      await tx.opsProject.update({ where: { id: task.projectId }, data: { status: "completed", completedAt: now } });
      return "completed" as const;
    }
    if (!shouldComplete && task.project.status === "completed") {
      await tx.opsProject.update({ where: { id: task.projectId }, data: { status: "active", completedAt: null } });
      return "reopened" as const;
    }
    return null;
  });

  await recordOpsActivity({
    projectId: task.projectId,
    taskId: task.id,
    actorId: userId,
    type: TASK_ACTION_ACTIVITY[action],
    summary: `${task.name} — ${action}`,
    metadata: { taskId: task.id, action, ...(d.blockedReason ? { blockedReason: d.blockedReason } : {}) },
  });
  if (projectStatusChange) {
    await recordOpsActivity({
      projectId: task.projectId,
      actorId: userId,
      type: projectStatusChange === "completed" ? "PROJECT_COMPLETED" : "PROJECT_REOPENED",
      summary: projectStatusChange === "completed" ? "All required steps done — project completed" : "Project reopened",
    });
  }

  return NextResponse.json({ ok: true, projectStatusChange });
});
