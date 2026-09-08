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
