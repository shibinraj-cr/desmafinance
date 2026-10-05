import type { Prisma, SalesTrainingQuestion } from "@prisma/client";
import { prisma } from "./prisma";
import { moduleStatus, type GradedQuestion, type ModuleStatus, type TrainingQuestion, type TrainingVideo } from "./sales-training";

export function toVideos(json: Prisma.JsonValue): TrainingVideo[] {
  return Array.isArray(json) ? (json as unknown as TrainingVideo[]) : [];
}

export function toQuestion(q: SalesTrainingQuestion): TrainingQuestion {
  return {
    id: q.id,
    kind: q.kind === "multi" ? "multi" : "single",
    prompt: q.prompt,
    options: Array.isArray(q.options) ? (q.options as string[]) : [],
    correct: Array.isArray(q.correct) ? (q.correct as number[]) : [],
    points: q.points,
    explanation: q.explanation,
  };
}

/** Active programme enrolment for an employee, or null. */
export async function activeLearner(employeeId: string) {
  const l = await prisma.salesTrainingLearner.findUnique({ where: { employeeId } });
  return l?.active ? l : null;
}

/** True once every video in the module has been watched past WATCH_THRESHOLD_PCT. */
export async function videosWatched(moduleId: string, employeeId: string, videos: TrainingVideo[]): Promise<boolean> {
  if (videos.length === 0) return true;
  const rows = await prisma.salesTrainingWatch.findMany({
    where: { moduleId, employeeId, completedAt: { not: null } },
    select: { videoId: true },
  });
  const done = new Set(rows.map((r) => r.videoId));
  return videos.every((v) => done.has(v.id));
}

/** Fan an in-app HR notification out to the given employees. */
export async function notifyEmployees(
  employeeIds: string[],
  n: { title: string; body: string; linkUrl: string; createdById: string | null },
) {
  if (employeeIds.length === 0) return;
  const notif = await prisma.hrNotification.create({
    data: { title: n.title, body: n.body, linkUrl: n.linkUrl, kind: "sales_training", createdById: n.createdById },
  });
  await prisma.hrNotificationReceipt.createMany({
    data: employeeIds.map((employeeId) => ({ notificationId: notif.id, employeeId })),
    skipDuplicates: true,
  });
}

/**
 * What a learner may see of a graded attempt. The answer key and explanations
 * only come out once they've passed or used up their attempts — before that,
 * revealing them would turn the retake into a copy exercise.
 */
export function learnerView(graded: GradedQuestion[], reveal: boolean) {
  return graded.map((q) => ({
    id: q.id,
    kind: q.kind,
    prompt: q.prompt,
    options: q.options,
    points: q.points,
    chosen: q.chosen,
    earned: q.earned,
    isCorrect: q.isCorrect,
    correct: reveal ? q.correct : null,
    explanation: reveal ? q.explanation : null,
  }));
}

export type LearnerGradedQuestion = ReturnType<typeof learnerView>[number];

export type ModuleProgress = {
  moduleId: string;
  attempts: number;
  bestPercent: number | null;
  passed: boolean;
  status: ModuleStatus;
  videosDone: number;
  videosTotal: number;
  lastActivity: Date | null;
};

/**
 * Per-learner, per-module progress for the given published modules. Voided
 * attempts (HR resets) are ignored. Returns Map<employeeId, Map<moduleId, …>>.
 */
export async function loadProgress(
  modules: { id: string; videos: Prisma.JsonValue; maxAttempts: number | null }[],
  employeeIds: string[],
): Promise<Map<string, Map<string, ModuleProgress>>> {
  const moduleIds = modules.map((m) => m.id);
  const [attempts, watches] = await Promise.all([
    prisma.salesTrainingAttempt.findMany({
      where: { moduleId: { in: moduleIds }, employeeId: { in: employeeIds }, voidedAt: null },
      select: { moduleId: true, employeeId: true, percent: true, passed: true, submittedAt: true },
    }),
    prisma.salesTrainingWatch.findMany({
      where: { moduleId: { in: moduleIds }, employeeId: { in: employeeIds } },
      select: { moduleId: true, employeeId: true, videoId: true, completedAt: true, watchedPct: true, updatedAt: true },
    }),
  ]);
  const out = new Map<string, Map<string, ModuleProgress>>();
  for (const empId of employeeIds) {
    const row = new Map<string, ModuleProgress>();
    for (const m of modules) {
      const videos = toVideos(m.videos);
      const videoIds = new Set(videos.map((v) => v.id));
      const att = attempts.filter((a) => a.employeeId === empId && a.moduleId === m.id);
      const w = watches.filter((x) => x.employeeId === empId && x.moduleId === m.id && videoIds.has(x.videoId));
      const passed = att.some((a) => a.passed);
      const bestPercent = att.length ? Math.max(...att.map((a) => a.percent)) : null;
      const times = [...att.map((a) => a.submittedAt), ...w.map((x) => x.updatedAt)];
      row.set(m.id, {
        moduleId: m.id,
        attempts: att.length,
        bestPercent,
        passed,
        status: moduleStatus({
          bestPassed: passed,
          attempts: att.length,
          maxAttempts: m.maxAttempts,
          anyWatchProgress: w.some((x) => x.watchedPct > 0),
        }),
        videosDone: w.filter((x) => x.completedAt).length,
        videosTotal: videos.length,
        lastActivity: times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : null,
      });
    }
    out.set(empId, row);
  }
  return out;
}

/** Roll a learner's module rows into programme-level numbers. */
export function summarise(rows: ModuleProgress[]) {
  const passed = rows.filter((r) => r.passed).length;
  const scored = rows.filter((r) => r.bestPercent != null);
  const avg = scored.length ? Math.round(scored.reduce((s, r) => s + (r.bestPercent ?? 0), 0) / scored.length) : null;
  const last = rows.reduce<Date | null>((acc, r) => (r.lastActivity && (!acc || r.lastActivity > acc) ? r.lastActivity : acc), null);
  return {
    passed,
    total: rows.length,
    completionPct: rows.length ? Math.round((passed * 100) / rows.length) : 0,
    avgScore: avg,
    lastActivity: last,
  };
}
