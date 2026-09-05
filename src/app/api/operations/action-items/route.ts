import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, canEditProject, roleIsOpsUser, type OpsAccess } from "@/lib/ops-rbac";
import { opsActionItemInclude, serializeActionItem } from "@/lib/ops-action-items";
import { opsDateToPrisma } from "@/lib/ops-dates";
import { recordOpsActivity } from "@/lib/ops-activity";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  // Where the task hangs, in order of precedence: `taskId` = a step (the
  // project is derived from it), `projectId` alone = a project-level task,
  // neither = a standalone personal to-do.
  taskId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
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

/** Where a new task hangs, once resolved and authorized. */
type Anchor = { projectId: string | null; stepId: string | null; stepName: string | null };

/**
 * Resolve the anchor and check the caller may put a task there. A step or
 * project anchor requires edit rights on that project; a standalone task needs
 * nothing beyond being an ops user (already checked by the caller).
 */
async function resolveAnchor(
  d: z.infer<typeof CreateSchema>,
  access: OpsAccess,
  userId: string,
): Promise<Anchor> {
  if (d.taskId) {
    const step = await prisma.opsTask.findUnique({
      where: { id: d.taskId },
      select: { id: true, name: true, projectId: true, project: { select: { assignedToId: true } } },
    });
    if (!step) throw notFound();
    // A step named alongside a *different* project is a client bug, not a
    // silent re-parent — the step's own project always wins, so reject it.
    if (d.projectId && d.projectId !== step.projectId) {
      throw badRequest("That step does not belong to the selected project.", "step_project_mismatch");
    }
    if (!canEditProject(access, step.project, userId)) throw forbidden();
    return { projectId: step.projectId, stepId: step.id, stepName: step.name };
  }

  if (d.projectId) {
    const project = await prisma.opsProject.findUnique({
      where: { id: d.projectId },
      select: { id: true, assignedToId: true },
    });
    if (!project) throw notFound();
    if (!canEditProject(access, project, userId)) throw forbidden();
    return { projectId: project.id, stepId: null, stepName: null };
  }

  return { projectId: null, stepId: null, stepName: null };
}

// POST /api/operations/action-items — create an ad-hoc task, scheduled with an
// optional due date. It attaches to a step (`taskId`), to a project
// (`projectId`), or to nothing at all — a standalone personal to-do.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = getOpsAccess(userId, perms);
  if (!access.isOpsUser) throw forbidden();

  const d = CreateSchema.parse(await req.json().catch(() => null));
  const anchor = await resolveAnchor(d, access, userId);

  if (d.assignedToId) await assertOpsAssignee(d.assignedToId);

  const created = await prisma.opsActionItem.create({
    data: {
      projectId: anchor.projectId,
      taskId: anchor.stepId,
      title: d.title,
      description: d.description ?? null,
      assignedToId: d.assignedToId ?? null,
      dueAt: d.dueAt ? opsDateToPrisma(d.dueAt) : null,
      createdById: userId,
    },
    include: opsActionItemInclude,
  });

  // Only a project-anchored task has a timeline to land on; a standalone task
  // belongs to no candidate, so there is nothing to record it against.
  if (anchor.projectId) {
    await recordOpsActivity({
      projectId: anchor.projectId,
      taskId: anchor.stepId,
      actorId: userId,
      type: "TASK_ADDED",
      summary: anchor.stepName ? `Task added on "${anchor.stepName}": ${d.title}` : `Task added: ${d.title}`,
      metadata: { actionItemId: created.id, assignedToId: d.assignedToId ?? null },
    });
  }

  return NextResponse.json({ actionItem: serializeActionItem(created) }, { status: 201 });
});
