import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";

const Schema = z.object({
  answers: z.record(z.string(), z.number().int().min(0)),
  watchedPct: z.number().int().min(0).max(100).optional(),
});

type QuizQ = { id: string; prompt: string; choices: string[]; correctIndex: number };

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);
  if (!emp) return NextResponse.json({ error: "no employee profile" }, { status: 400 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const training = await prisma.hrTraining.findUnique({ where: { id: params.id } });
  if (!training || training.status !== "published") {
    return NextResponse.json({ error: "training not available" }, { status: 404 });
  }
  const quiz = (training.quiz as unknown as QuizQ[]) ?? [];
  let correct = 0;
  for (const q of quiz) {
    if (parsed.data.answers[q.id] === q.correctIndex) correct++;
  }
  const score = quiz.length === 0 ? 100 : Math.round((correct * 100) / quiz.length);
  const passed = score >= training.passingScore;

  const progress = await prisma.hrTrainingProgress.upsert({
    where: { trainingId_employeeId: { trainingId: training.id, employeeId: emp.id } },
    update: {
      score,
      attempts: { increment: 1 },
      passed,
      answers: parsed.data.answers,
      watchedPct: parsed.data.watchedPct ?? undefined,
      completedAt: passed ? new Date() : null,
    },
    create: {
      trainingId: training.id,
      employeeId: emp.id,
      score,
      attempts: 1,
      passed,
      answers: parsed.data.answers,
      watchedPct: parsed.data.watchedPct ?? 0,
      completedAt: passed ? new Date() : null,
    },
  });
  return NextResponse.json({ progress, score, passed });
}
