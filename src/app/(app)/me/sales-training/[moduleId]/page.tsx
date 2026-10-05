import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import type { GradedQuestion } from "@/lib/sales-training";
import { activeLearner, learnerView, toQuestion, toVideos } from "@/lib/sales-training-db";
import { ModulePlayer } from "./client";

export const dynamic = "force-dynamic";

export default async function MySalesTrainingModulePage({ params }: { params: { moduleId: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");
  const emp = await employeeForUser(userId);
  if (!emp || !(await activeLearner(emp.id))) redirect("/me/sales-training");

  const mod = await prisma.salesTrainingModule.findUnique({
    where: { id: params.moduleId },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  });
  if (!mod || mod.status !== "published") notFound();

  const [watches, attempts, order] = await Promise.all([
    prisma.salesTrainingWatch.findMany({ where: { moduleId: mod.id, employeeId: emp.id } }),
    prisma.salesTrainingAttempt.findMany({
      where: { moduleId: mod.id, employeeId: emp.id, voidedAt: null },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.salesTrainingModule.findMany({ where: { status: "published" }, orderBy: { sortOrder: "asc" }, select: { id: true } }),
  ]);

  const videos = toVideos(mod.videos);
  const watchBy = new Map(watches.map((w) => [w.videoId, w]));
  const passedAttempt = attempts.filter((a) => a.passed).sort((a, b) => b.percent - a.percent)[0];
  const outOfAttempts = !passedAttempt && mod.maxAttempts != null && attempts.length >= mod.maxAttempts;
  const reviewAttempt = passedAttempt ?? attempts[0];
  const reveal = !!passedAttempt || outOfAttempts;
  const idx = order.findIndex((o) => o.id === mod.id);

  return (
    <>
      <TopBar title={mod.title} subtitle={`Module ${idx + 1} of ${order.length}`} />
      <div className="p-margin space-y-lg">
        {mod.description && (
          <Section title="">
            <p className="text-body-md text-on-surface whitespace-pre-line">{mod.description}</p>
          </Section>
        )}
        <ModulePlayer
          moduleId={mod.id}
          nextModuleId={order[idx + 1]?.id ?? null}
          passMark={mod.passMark}
          maxAttempts={mod.maxAttempts}
          requireWatch={mod.requireWatch}
          videos={videos.map((v) => ({
            id: v.id,
            title: v.title,
            youtubeId: v.youtubeId,
            pct: watchBy.get(v.id)?.watchedPct ?? 0,
            completed: !!watchBy.get(v.id)?.completedAt,
          }))}
          // The answer key never leaves the server for an open quiz.
          questions={mod.questions.map(toQuestion).map((q) => ({ id: q.id, kind: q.kind, prompt: q.prompt, options: q.options, points: q.points }))}
          attemptsUsed={attempts.length}
          state={passedAttempt ? "passed" : outOfAttempts ? "out" : "open"}
          review={
            reviewAttempt
              ? {
                  percent: reviewAttempt.percent,
                  score: reviewAttempt.score,
                  maxScore: reviewAttempt.maxScore,
                  passed: reviewAttempt.passed,
                  submittedAt: reviewAttempt.submittedAt.toISOString(),
                  questions: learnerView(reviewAttempt.graded as unknown as GradedQuestion[], reveal),
                }
              : null
          }
        />
      </div>
    </>
  );
}
