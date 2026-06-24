import type { OpsActivityType } from "./ops-activity";

/**
 * Pure state-machine logic for operations task transitions and project
 * completion roll-up. Kept side-effect-free so it's unit-testable; the API
 * route applies the returned patch, writes the activity, and persists.
 */

export type TaskAction = "start" | "complete" | "block" | "skip" | "reopen";

export type TaskPatch = {
  status: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  completedById?: string | null;
  blockedReason?: string | null;
};

const DONE = new Set(["completed", "skipped"]);

/** The activity type recorded for each action (for the project timeline). */
export const TASK_ACTION_ACTIVITY: Record<TaskAction, OpsActivityType> = {
  start: "STEP_STARTED",
  complete: "STEP_COMPLETED",
  block: "STEP_BLOCKED",
  skip: "STEP_SKIPPED",
  reopen: "STEP_REOPENED",
};

/**
 * Compute the field patch for a task transition. `now` and `actorId` are passed
 * in (no clock/DB access here). `startedAt` is stamped on first progress and
 * preserved thereafter; `completedAt`/`completedById` are set on completion and
 * cleared on reopen/skip.
 */
export function applyTaskTransition(
  task: { status: string; startedAt: Date | null },
  action: TaskAction,
  ctx: { actorId: string | null; now: Date; blockedReason?: string | null },
): TaskPatch {
  switch (action) {
    case "start":
      return { status: "in_progress", startedAt: task.startedAt ?? ctx.now };
    case "complete":
      return {
        status: "completed",
        startedAt: task.startedAt ?? ctx.now,
        completedAt: ctx.now,
        completedById: ctx.actorId,
        blockedReason: null,
      };
    case "block":
      return { status: "blocked", blockedReason: ctx.blockedReason ?? null };
    case "skip":
      return { status: "skipped", completedAt: null, completedById: null, blockedReason: null };
    case "reopen":
      return { status: "pending", completedAt: null, completedById: null, blockedReason: null };
  }
}

/**
 * Whether a project should be considered complete: every *required* task is
 * done (completed or skipped). If the template has no required tasks, fall back
 * to "all tasks done". Empty project → not complete.
 */
export function deriveProjectCompleted(tasks: { isRequired: boolean; status: string }[]): boolean {
  if (tasks.length === 0) return false;
  const required = tasks.filter((t) => t.isRequired);
  const blocking = required.length > 0 ? required : tasks;
  return blocking.every((t) => DONE.has(t.status));
}
