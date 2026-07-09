import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, canEditProject } from "@/lib/ops-rbac";
import { applyTaskTransition, deriveProjectCompleted, TASK_ACTION_ACTIVITY, type TaskAction } from "@/lib/ops-tasks";
import { recomputeSchedule } from "@/lib/ops-projects";
import { loadHolidaySet, opsDateKey } from "@/lib/ops-dates";
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
      project: { select: { id: true, assignedToId: true, status: true, createdAt: true, dueAt: true } },
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
  // complete/skip/reopen shift the done-set, so the rolling schedule is recomputed.
  const reschedule = action === "complete" || action === "skip" || action === "reopen";

  const projectStatusChange = await prisma.$transaction(async (tx) => {
    await tx.opsTask.update({
      where: { id: params.id },
      data: { ...patch, ...(d.notes !== undefined ? { notes: d.notes } : {}) },
    });

    // Read the resulting task set once — feeds both the schedule recompute and
    // the project-status roll-up.
    const siblings = await tx.opsTask.findMany({
      where: { projectId: task.projectId },
      select: { id: true, seq: true, isRequired: true, status: true, slaDays: true, completedAt: true, dueAt: true },
    });

    // Rolling turnaround: re-anchor every open step's due date on the actual
    // completion dates, and roll the project ETA up. Only dates that moved are
    // written.
    if (reschedule) {
      const holidays = await loadHolidaySet(tx);
      const startKey = opsDateKey(task.project.createdAt);
      const { updates, projectDueAt } = recomputeSchedule(siblings, startKey, holidays);
      const currentDue = new Map(siblings.map((s) => [s.id, s.dueAt] as const));
      for (const u of updates) {
        const cur = currentDue.get(u.id) ?? null;
        if ((cur?.getTime() ?? null) !== (u.dueAt?.getTime() ?? null)) {
          await tx.opsTask.update({ where: { id: u.id }, data: { dueAt: u.dueAt } });
        }
      }
      if ((task.project.dueAt?.getTime() ?? null) !== (projectDueAt?.getTime() ?? null)) {
        await tx.opsProject.update({ where: { id: task.projectId }, data: { dueAt: projectDueAt } });
      }
    }

    // Roll the project status up/down from the resulting task set.
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
