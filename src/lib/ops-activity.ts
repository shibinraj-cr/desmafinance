import { prisma } from "./prisma";

/**
 * The Operations activity taxonomy. Every project/task state change writes one
 * of these to `OpsTaskActivity`, the single source of truth for the project
 * Timeline and (via `actorId`) performance attribution. Clone of
 * `src/lib/crm-activity.ts`.
 */
export const OPS_ACTIVITY_TYPES = [
  "PROJECT_CREATED",
  "ASSIGNED",
  "REASSIGNED",
  "UNASSIGNED",
  "STEP_STARTED",
  "STEP_COMPLETED",
  "STEP_REOPENED",
  "STEP_BLOCKED",
  "STEP_SKIPPED",
  // Ad-hoc tasks ("Task" in the UI) attached to a step — distinct from the
  // STEP_* checklist events above.
  "TASK_ADDED",
  "TASK_ASSIGNED",
  "TASK_COMPLETED",
  "TASK_REOPENED",
  "TASK_CANCELLED",
  "DOCUMENT_ADDED",
  "DOCUMENT_ANALYZED",
  "DOCUMENT_REMOVED",
  "NOTE_ADDED",
  "PROJECT_COMPLETED",
  "PROJECT_REOPENED",
  "IMPORTED",
] as const;

export type OpsActivityType = (typeof OPS_ACTIVITY_TYPES)[number];

/**
 * Record one operations activity and (by default) bump
 * `project.lastActivityAt`. Best-effort: wrapped in try/catch like
 * `recordAudit` / `recordLeadActivity` so a logging failure never breaks the
 * user's action. Fire-and-forget — returns `void`.
 */
export async function recordOpsActivity(opts: {
  projectId: string;
  taskId?: string | null;
  actorId?: string | null;
  type: OpsActivityType;
  summary?: string | null;
  metadata?: unknown;
  /** Override the default lastActivityAt bump (defaults to true). */
  bumpLastActivity?: boolean;
}): Promise<void> {
  try {
    const bump = opts.bumpLastActivity ?? true;
    await prisma.$transaction(async (tx) => {
      await tx.opsTaskActivity.create({
        data: {
          projectId: opts.projectId,
          taskId: opts.taskId ?? null,
          actorId: opts.actorId ?? null,
          type: opts.type,
          summary: opts.summary ?? null,
          metadata: opts.metadata ? (opts.metadata as object) : undefined,
        },
      });
      if (bump) {
        await tx.opsProject.update({
          where: { id: opts.projectId },
          data: { lastActivityAt: new Date() },
        });
      }
    });
  } catch (e) {
    console.error("[ops-activity] failed to record activity:", e);
  }
}
