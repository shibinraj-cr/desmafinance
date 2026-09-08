import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { TalentPoolEventType } from "./constants";

/**
 * Append one entry to a pooled candidate's activity history.
 *
 * Deliberately never throws. History is a record of the work, not part of it —
 * losing a timeline row is bad, but losing somebody's stage change because the
 * write of its history row failed is worse.
 */
export async function recordPoolEvent(input: {
  candidateId: string;
  type: TalentPoolEventType;
  fromState?: string | null;
  toState?: string | null;
  note?: string | null;
  actorId: string | null;
}): Promise<void> {
  try {
    await prisma.hiringTalentPoolEvent.create({
      data: {
        candidateId: input.candidateId,
        type: input.type,
        fromState: input.fromState ?? null,
        toState: input.toState ?? null,
        note: input.note?.trim() || null,
        actorId: input.actorId,
      },
    });
  } catch (e) {
    logger.error("hiring_pool_event_failed", {
      candidateId: input.candidateId,
      type: input.type,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** How the pool can be ordered. `fit` needs a job to be meaningful. */
export const POOL_SORTS = ["fit", "due", "recent", "name"] as const;
export type PoolSort = (typeof POOL_SORTS)[number];

/** The shape `orderPool` needs — a subset of what the page actually loads. */
export type OrderablePoolRow = {
  fullName: string;
  nextTouchAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  /** Fit against the job being filtered on, or null when none is. */
  forJob: number | null;
  /** Best fit across all open roles. */
  best: number;
};

/**
 * Order the pool. Pure, so the tie-breaks are testable — and they matter:
 * a pool sorted by fit is mostly ties at 0%, and an unstable order there makes
 * the page look like it reshuffles itself between reads.
 */
export function orderPool<T extends OrderablePoolRow>(rows: T[], sort: PoolSort, hasJob: boolean): T[] {
  return [...rows].sort((a, b) => {
    if (sort === "fit") {
      const d = hasJob ? (b.forJob ?? 0) - (a.forJob ?? 0) : b.best - a.best;
      if (d !== 0) return d;
      return a.fullName.localeCompare(b.fullName);
    }
    if (sort === "name") return a.fullName.localeCompare(b.fullName);
    if (sort === "recent") return b.createdAt.getTime() - a.createdAt.getTime();
    // "due": soonest follow-up first, and NEVER-scheduled last rather than
    // first — a null date is "no follow-up planned", not "overdue since 1970".
    const an = a.nextTouchAt?.getTime() ?? Infinity;
    const bn = b.nextTouchAt?.getTime() ?? Infinity;
    return an - bn || b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}
