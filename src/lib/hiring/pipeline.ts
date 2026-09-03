import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, conflict } from "@/lib/http-error";
import { emitHireCompleted, buildHireCompletedPayload } from "./events";

/**
 * Stage movement — the one place an application changes stage.
 *
 * Every move writes a `stage_moved` row and NEVER overwrites history: the
 * funnel, time-in-stage and conversion numbers in /hiring/analytics are all
 * derived from HiringApplicationEvent, so a move that only updated
 * `application.stageId` would silently corrupt every one of them.
 *
 * `status` is derived from the destination stage's kind, so "rejected" and
 * "hired" cannot drift from the column the card is actually sitting in.
 */

export type MoveResult = {
  applicationId: string;
  fromStage: string | null;
  toStage: string;
  status: string;
};

/** The application status implied by a stage's kind. */
export function statusForStageKind(kind: string, current: string): string {
  if (kind === "won") return "hired";
  if (kind === "lost") return "rejected";
  if (kind === "hold") return "on_hold";
  // Moving back into an open stage reactivates a rejected/held application —
  // that IS what dragging the card back means.
  return current === "withdrawn" ? "withdrawn" : "active";
}

export async function moveApplication(opts: {
  applicationId: string;
  toStageId: string;
  actorId: string;
  /** Required when moving into a `lost` stage. */
  reason?: string | null;
  /** Set when the move came from a recipe rather than a person. */
  automationId?: string | null;
}): Promise<MoveResult> {
  const app = await prisma.hiringApplication.findFirst({
    where: { id: opts.applicationId, deletedAt: null },
    include: { stage: true, job: { select: { id: true } } },
  });
  if (!app) throw notFound("That application no longer exists.");

  const toStage = await prisma.hiringJobStage.findUnique({ where: { id: opts.toStageId } });
  if (!toStage) throw notFound("That stage no longer exists.");
  if (toStage.jobId !== app.jobId) {
    throw badRequest("That stage belongs to a different requisition.", "stage_wrong_job");
  }
  if (app.stageId === toStage.id) {
    throw conflict("The candidate is already in that stage.", "already_in_stage");
  }
  if (toStage.kind === "lost" && !opts.reason?.trim()) {
    throw badRequest("Give a reason when rejecting someone.", "reason_required");
  }

  const now = new Date();
  const status = statusForStageKind(toStage.kind, app.status);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.hiringApplication.update({
      where: { id: app.id },
      data: {
        stageId: toStage.id,
        status,
        stageEnteredAt: now,
        hiredAt: toStage.kind === "won" ? (app.hiredAt ?? now) : app.hiredAt,
        rejectionReason: toStage.kind === "lost" ? (opts.reason?.trim() ?? null) : null,
        // Re-entering the pipeline clears the screening flag: a human has now
        // looked and decided, which is exactly what the flag was asking for.
        needsAttention: toStage.kind === "open" ? false : app.needsAttention,
      },
    });

    await tx.hiringApplicationEvent.create({
      data: {
        applicationId: app.id,
        type: toStage.kind === "lost" ? "rejected" : "stage_moved",
        fromStage: app.stage?.name ?? null,
        toStage: toStage.name,
        actorId: opts.automationId ? null : opts.actorId,
        payload: {
          fromKind: app.stage?.kind ?? null,
          toKind: toStage.kind,
          reason: opts.reason?.trim() ?? null,
          ...(opts.automationId ? { automationId: opts.automationId } : {}),
        },
        occurredAt: now,
      },
    });

    return updated;
  });

  // Moving into a `won` stage IS the hire. Emitting here rather than from a
  // separate "mark hired" action means there is exactly one way to be hired,
  // and therefore exactly one place the handoff event can be missed from.
  // Best-effort by construction: emitHireCompleted never throws, because a hire
  // that happened must not be rolled back by a failure to announce it.
  if (toStage.kind === "won") {
    const payload = await buildHireCompletedPayload(app.id);
    if (payload) await emitHireCompleted(payload);
  }

  return {
    applicationId: result.id,
    fromStage: app.stage?.name ?? null,
    toStage: toStage.name,
    status: result.status,
  };
}

/**
 * Move several applications at once (the pipeline's bulk-select action).
 *
 * Each one is moved independently, and a failure on one is REPORTED rather
 * than rolled into a single all-or-nothing transaction: with 40 cards selected,
 * failing all 40 because one is already in the target stage would be worse than
 * moving 39 and saying which one did not.
 */
export async function moveMany(opts: {
  applicationIds: string[];
  toStageId: string;
  actorId: string;
  reason?: string | null;
}): Promise<{ moved: number; failures: { applicationId: string; message: string }[] }> {
  const failures: { applicationId: string; message: string }[] = [];
  let moved = 0;
  for (const id of opts.applicationIds) {
    try {
      await moveApplication({
        applicationId: id,
        toStageId: opts.toStageId,
        actorId: opts.actorId,
        reason: opts.reason,
      });
      moved++;
    } catch (e) {
      failures.push({
        applicationId: id,
        message: e instanceof Error ? e.message : "Could not move this one.",
      });
    }
  }
  return { moved, failures };
}

/** Log an outbound touch. Drives "days since last contact" on Follow-ups. */
export async function recordContact(opts: {
  applicationId: string;
  actorId: string | null;
  channel: "whatsapp_sent" | "email_sent" | "note";
  payload?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.$transaction([
    prisma.hiringApplication.update({
      where: { id: opts.applicationId },
      data: { lastContactedAt: new Date() },
    }),
    prisma.hiringApplicationEvent.create({
      data: {
        applicationId: opts.applicationId,
        type: opts.channel,
        actorId: opts.actorId,
        payload: opts.payload,
      },
    }),
  ]);
}

/** SLA breach: longer in the current stage than that stage allows. */
export function isSlaBreached(
  app: { stageEnteredAt: Date; status: string },
  stage: { slaDays: number | null; kind: string } | null,
  now: Date = new Date(),
): boolean {
  if (!stage?.slaDays || stage.kind !== "open") return false;
  if (app.status !== "active") return false;
  const days = (now.getTime() - app.stageEnteredAt.getTime()) / 86_400_000;
  return days > stage.slaDays;
}

/** Whole days the application has sat in its current stage. */
export function daysInStage(app: { stageEnteredAt: Date }, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - app.stageEnteredAt.getTime()) / 86_400_000));
}
