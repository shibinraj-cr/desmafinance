import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "./prisma";
import { toPrismaDate } from "./lead-pulse-dates";

/**
 * Machine-to-machine auth for the daily WhatsApp scoring routine.
 * Header: `Authorization: Bearer <TEAM_PERF_INGEST_TOKEN>`.
 * Returns false when the env var is unset, so the endpoints stay closed by default.
 */
export function isValidIngestToken(req: Request): boolean {
  const expected = process.env.TEAM_PERF_INGEST_TOKEN ?? "";
  if (expected.length < 24) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const score = z.number().min(0).max(10).nullable().optional();

export const scoreRowSchema = z.object({
  date: day,
  staff: z.string().trim().min(1).max(80),
  queriesAnswered: z.number().int().min(0),
  medianResponseMin: z.number().min(0).nullable().optional(),
  avgAccuracy: score,
  avgCompleteness: score,
  avgTone: score,
  avgNextStep: score,
  closuresDone: z.number().int().min(0).default(0),
  closuresNeeded: z.number().int().min(0).default(0),
  sundayHolidayActive: z.boolean().nullable().optional(),
  source: z.enum(["auto", "manual"]).default("auto"),
  notes: z.string().max(2000).nullable().optional(),
});

export const unansweredRowSchema = z.object({
  date: day,
  groupName: z.string().trim().min(1).max(200),
  queryAt: z.string().trim().min(1).max(40),
  summary: z.string().trim().max(500),
  status: z.string().trim().max(300),
});

export const ingestSchema = z.object({
  scores: z.array(scoreRowSchema).max(2000).default([]),
  unanswered: z.array(unansweredRowSchema).max(2000).default([]),
});

export type IngestPayload = z.infer<typeof ingestSchema>;

/** Idempotent upsert: (date, staff) for scores, (groupName, queryAt) for unanswered. */
export async function ingestScores(p: IngestPayload) {
  let scores = 0;
  let unanswered = 0;
  for (const r of p.scores) {
    const data = {
      queriesAnswered: r.queriesAnswered,
      medianResponseMin: r.medianResponseMin ?? null,
      avgAccuracy: r.avgAccuracy ?? null,
      avgCompleteness: r.avgCompleteness ?? null,
      avgTone: r.avgTone ?? null,
      avgNextStep: r.avgNextStep ?? null,
      closuresDone: r.closuresDone,
      closuresNeeded: r.closuresNeeded,
      sundayHolidayActive: r.sundayHolidayActive ?? null,
      source: r.source,
      notes: r.notes ?? null,
    };
    await prisma.perfWaStaffDaily.upsert({
      where: { date_staff: { date: toPrismaDate(r.date), staff: r.staff } },
      create: { date: toPrismaDate(r.date), staff: r.staff, ...data },
      update: data,
    });
    scores++;
  }
  for (const u of p.unanswered) {
    await prisma.perfWaUnanswered.upsert({
      where: { groupName_queryAt: { groupName: u.groupName, queryAt: u.queryAt } },
      create: { ...u, date: toPrismaDate(u.date) },
      update: { date: toPrismaDate(u.date), summary: u.summary, status: u.status },
    });
    unanswered++;
  }
  return { scores, unanswered };
}
