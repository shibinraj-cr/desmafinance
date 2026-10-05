import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { gradeAttempt } from "@/lib/sales-training";
import { activeLearner, learnerView, toQuestion, toVideos, videosWatched } from "@/lib/sales-training-db";

const Schema = z.object({
  answers: z.record(z.string(), z.array(z.number().int().min(0).max(20)).max(20)),
});

export async function POST(req: Request, { params }: { params: { moduleId: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);
  if (!emp || !(await activeLearner(emp.id))) {
    return NextResponse.json({ error: "You're not enrolled in Sales Training." }, { status: 403 });
  }
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const mod = await prisma.salesTrainingModule.findUnique({
    where: { id: params.moduleId },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  });
  if (!mod || mod.status !== "published") return NextResponse.json({ error: "Module not available." }, { status: 404 });
  if (mod.questions.length === 0) return NextResponse.json({ error: "This module has no questions yet." }, { status: 400 });

  if (mod.requireWatch && !(await videosWatched(mod.id, emp.id, toVideos(mod.videos)))) {
    return NextResponse.json({ error: "Finish watching the videos to unlock the quiz." }, { status: 409 });
  }

  const prior = await prisma.salesTrainingAttempt.findMany({
    where: { moduleId: mod.id, employeeId: emp.id, voidedAt: null },
    select: { passed: true },
  });
  if (prior.some((a) => a.passed)) return NextResponse.json({ error: "You've already passed this module." }, { status: 409 });
  if (mod.maxAttempts != null && prior.length >= mod.maxAttempts) {
    return NextResponse.json({ error: "No attempts left — ask HR to reset this module for you." }, { status: 409 });
  }

  const result = gradeAttempt(mod.questions.map(toQuestion), parsed.data.answers, mod.passMark);
  await prisma.salesTrainingAttempt.create({
    data: {
      moduleId: mod.id,
      employeeId: emp.id,
      answers: parsed.data.answers,
      graded: result.graded,
      score: result.score,
      maxScore: result.maxScore,
      percent: result.percent,
      passed: result.passed,
    },
  });

  const attemptsUsed = prior.length + 1;
  const outOfAttempts = mod.maxAttempts != null && attemptsUsed >= mod.maxAttempts;
  return NextResponse.json({
    score: result.score,
    maxScore: result.maxScore,
    percent: result.percent,
    passed: result.passed,
    attemptsUsed,
    questions: learnerView(result.graded, result.passed || outOfAttempts),
  });
}
