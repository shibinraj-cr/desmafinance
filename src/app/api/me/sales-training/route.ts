import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { activeLearner, loadProgress, summarise, toVideos } from "@/lib/sales-training-db";

export const dynamic = "force-dynamic";

// ── GET /api/me/sales-training — the learner's programme, for the mobile app ─
// The same data the /me/sales-training page renders on the server: published
// modules with their videos, and this learner's progress. Read-only; questions
// and answers are never included (the quiz stays on the web, where watch time
// is tracked).
export const GET = withApiHandler(async () => {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) throw unauthorized();
  const emp = await employeeForUser(userId);
  if (!emp) return NextResponse.json({ state: "not_linked" });
  const learner = await activeLearner(emp.id);
  if (!learner) return NextResponse.json({ state: "not_enrolled" });

  const modules = await prisma.salesTrainingModule.findMany({
    where: { status: "published" },
    orderBy: { sortOrder: "asc" },
    select: { id: true, title: true, description: true, videos: true, maxAttempts: true, passMark: true, _count: { select: { questions: true } } },
  });
  const progress = (await loadProgress(modules, [emp.id])).get(emp.id)!;
  const summary = summarise(modules.map((m) => progress.get(m.id)!));
  const dueDate = learner.dueDate ? learner.dueDate.toISOString().slice(0, 10) : null;

  return NextResponse.json({
    state: "enrolled",
    dueDate,
    overdue: !!dueDate && dueDate < new Date().toISOString().slice(0, 10) && summary.passed < summary.total,
    summary: { passed: summary.passed, total: summary.total, completionPct: summary.completionPct, avgScore: summary.avgScore },
    modules: modules.map((m) => {
      const p = progress.get(m.id)!;
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        passMark: m.passMark,
        maxAttempts: m.maxAttempts,
        questionCount: m._count.questions,
        videos: toVideos(m.videos),
        progress: { status: p.status, passed: p.passed, attempts: p.attempts, bestPercent: p.bestPercent, videosDone: p.videosDone, videosTotal: p.videosTotal },
      };
    }),
  });
});
