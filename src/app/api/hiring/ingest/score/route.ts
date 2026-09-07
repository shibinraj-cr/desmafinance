import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { logger } from "@/lib/logger";
import { requireHiring } from "@/lib/hiring/access";
import { scoreParsedResume } from "@/lib/hiring/ai/score";
import type { ParsedResume } from "@/lib/hiring/ai/resume-parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Each score is a model call; keep a request inside the function's 60 seconds. */
const MAX_PER_REQUEST = 8;

const schema = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(MAX_PER_REQUEST),
  /** Defaults to the batch's own requisition — the folder it was filed under. */
  jobId: z.string().optional(),
});

/**
 * POST /api/hiring/ingest/score — spend a rubric score on chosen résumés.
 *
 * Deliberately on demand rather than automatic for every file: scoring every
 * résumé against every open requisition is what turns a 20,000-credit budget
 * into an 80,000-credit one. The free ranking already tells you which are worth
 * the spend.
 */
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("candidate:write");
  const body = schema.parse(await req.json());

  const items = await prisma.hiringIngestItem.findMany({
    where: { id: { in: body.itemIds } },
    include: { batch: { select: { jobId: true } } },
  });
  if (!items.length) throw notFound("Those rows are no longer there.");

  const scored: { itemId: string; total: number }[] = [];
  const failed: { itemId: string; reason: string }[] = [];

  for (const item of items) {
    const parsed = item.parsed as unknown as ParsedResume | null;
    if (!parsed) {
      failed.push({ itemId: item.id, reason: "Nothing was parsed from this file." });
      continue;
    }
    try {
      const result = await scoreParsedResume({
        jobId: body.jobId ?? item.batch.jobId,
        userId: access.userId,
        entityId: item.id,
        parsed: {
          currentTitle: parsed.currentTitle,
          currentEmployer: parsed.currentEmployer,
          totalExperienceYears: parsed.totalExperienceYears,
          noticePeriodDays: parsed.noticePeriodDays,
          skills: parsed.skills,
          education: parsed.education,
        },
      });
      if (!result) {
        failed.push({ itemId: item.id, reason: "No AI key is configured." });
        continue;
      }
      await prisma.hiringIngestItem.update({
        where: { id: item.id },
        data: { aiScore: result.total, aiScoreBreakdown: result.breakdown as never },
      });
      scored.push({ itemId: item.id, total: result.total });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      failed.push({ itemId: item.id, reason: reason.slice(0, 200) });
      logger.error("hiring_ingest_score_failed", { itemId: item.id, message: reason });
    }
  }

  return NextResponse.json({ scored, failed });
});
