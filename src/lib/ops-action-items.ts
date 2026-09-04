import { Prisma } from "@prisma/client";
import type { OpsActivityType } from "./ops-activity";

/**
 * Logic + read-side helpers for Operations **action items** ("Task" in the UI):
 * the ad-hoc, assignable to-dos an ops user creates and schedules. Pure
 * transition/bucketing functions (unit-tested) plus Prisma includes and DTO
 * serializers for the in-step list and the personal task folder
 * (/operations/my-tasks). Mirrors the shape of `ops-tasks.ts` + `ops-queries.ts`.
 *
 * A task attaches at one of three levels (see the OpsActionItem doc comment):
 * step, project, or nothing at all (a standalone personal to-do). Both links
 * are nullable, so every serializer here reports the project/step context as
 * optional.
 */

export type ActionItemAction = "complete" | "reopen" | "cancel";

export type ActionItemPatch = {
  status: string;
  completedAt: Date | null;
  completedById: string | null;
};

/** The activity type recorded for each status action (for the project timeline). */
export const ACTION_ITEM_ACTIVITY: Record<ActionItemAction, OpsActivityType> = {
  complete: "TASK_COMPLETED",
  reopen: "TASK_REOPENED",
  cancel: "TASK_CANCELLED",
};

/**
 * Pure status transition for an action item. `complete` stamps
 * completedAt + completedById (so attribution survives project re-assignment,
 * same as a step's completedBy); `reopen`/`cancel` clear them.
 */
export function applyActionItemStatus(
  action: ActionItemAction,
  ctx: { actorId: string | null; now: Date },
): ActionItemPatch {
  switch (action) {
    case "complete":
      return { status: "done", completedAt: ctx.now, completedById: ctx.actorId };
    case "reopen":
      return { status: "open", completedAt: null, completedById: null };
    case "cancel":
      return { status: "cancelled", completedAt: null, completedById: null };
  }
}

/** Which folder section a task falls in, for the personal /my-tasks view. */
export type MyTaskBucket = "overdue" | "today" | "upcoming" | "no_due" | "done";

/**
 * Bucket an action item for the personal folder. Done/cancelled → "done";
 * otherwise by due date (IST `today` string, YYYY-MM-DD): before today →
 * overdue, today → today, after → upcoming, none → no_due.
 */
export function bucketMyTask(row: { status: string; dueAt: string | null }, today: string): MyTaskBucket {
  if (row.status === "done" || row.status === "cancelled") return "done";
  if (!row.dueAt) return "no_due";
  const d = row.dueAt.slice(0, 10);
  if (d < today) return "overdue";
  if (d === today) return "today";
  return "upcoming";
}

/**
 * The rows that make up one user's task folder: everything assigned to them,
 * plus anything they raised and left unassigned — without the second arm a task
 * created with no assignee would vanish the moment it was saved. Shared by the
 * /operations/my-tasks page and the sidebar's open-task badge, so the two can
 * never disagree about what "my tasks" means.
 */
export function myTasksWhere(userId: string): Prisma.OpsActionItemWhereInput {
  return { OR: [{ assignedToId: userId }, { assignedToId: null, createdById: userId }] };
}

// ---- read-side (includes + serializers) ----

export const opsActionItemInclude = Prisma.validator<Prisma.OpsActionItemInclude>()({
  assignedTo: { select: { id: true, username: true } },
  completedBy: { select: { id: true, username: true } },
});

type ActionItemPayload = Prisma.OpsActionItemGetPayload<{ include: typeof opsActionItemInclude }>;

export type OpsActionItemDTO = {
  id: string;
  projectId: string | null;
  taskId: string | null;
  title: string;
  description: string | null;
  /** 'open' | 'done' | 'cancelled' */
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  completedByName: string | null;
  completedAt: string | null;
  createdAt: string;
};

export function serializeActionItem(a: ActionItemPayload): OpsActionItemDTO {
  return {
    id: a.id,
    projectId: a.projectId,
    taskId: a.taskId,
    title: a.title,
    description: a.description,
    status: a.status,
    assigneeId: a.assignedToId,
    assigneeName: a.assignedTo?.username ?? null,
    dueAt: a.dueAt ? a.dueAt.toISOString() : null,
    completedByName: a.completedBy?.username ?? null,
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Include for the personal folder: adds the owning project + step context. */
export const opsMyTaskInclude = Prisma.validator<Prisma.OpsActionItemInclude>()({
  assignedTo: { select: { id: true, username: true } },
  completedBy: { select: { id: true, username: true } },
  project: { select: { id: true, party: { select: { name: true } }, service: { select: { name: true } } } },
  task: { select: { id: true, seq: true, name: true } },
});

type MyTaskPayload = Prisma.OpsActionItemGetPayload<{ include: typeof opsMyTaskInclude }>;

export type OpsMyTaskRow = OpsActionItemDTO & {
  /** Null for a standalone task — one created with no candidate project. */
  projectId: string | null;
  candidateName: string | null;
  serviceName: string | null;
  stepSeq: number | null;
  stepName: string | null;
};

export function serializeMyTaskRow(a: MyTaskPayload): OpsMyTaskRow {
  return {
    ...serializeActionItem(a as unknown as ActionItemPayload),
    projectId: a.projectId,
    candidateName: a.project?.party.name ?? null,
    serviceName: a.project?.service.name ?? null,
    stepSeq: a.task?.seq ?? null,
    stepName: a.task?.name ?? null,
  };
}
