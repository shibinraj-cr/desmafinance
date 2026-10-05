import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { NoAccess } from "@/components/sales-training/ui";
import type { GradedQuestion } from "@/lib/sales-training";
import { loadProgress, summarise } from "@/lib/sales-training-db";
import { LearnerDetail } from "./client";

export const dynamic = "force-dynamic";

export default async function SalesTrainingLearnerPage({ params }: { params: { employeeId: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) return <NoAccess title="Learner" />;

  const emp = await prisma.employee.findUnique({
    where: { id: params.employeeId },
    select: {
      id: true,
      name: true,
      empCode: true,
      designation: true,
      designationRef: { select: { name: true } },
      salesTrainingLearner: true,
    },
  });
  if (!emp) notFound();

  const [modules, attempts] = await Promise.all([
    prisma.salesTrainingModule.findMany({
      where: { status: { not: "draft" } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, title: true, status: true, videos: true, maxAttempts: true, passMark: true },
    }),
    prisma.salesTrainingAttempt.findMany({
      where: { employeeId: emp.id },
      orderBy: { submittedAt: "desc" },
    }),
  ]);
  // Archived modules only matter here if this learner has history on them.
  const relevant = modules.filter((m) => m.status === "published" || attempts.some((a) => a.moduleId === m.id));
  const progress = (await loadProgress(relevant, [emp.id])).get(emp.id)!;
  const live = relevant.filter((m) => m.status === "published");
  const s = summarise(live.map((m) => progress.get(m.id)!));

  return (
    <>
      <TopBar title={emp.name} subtitle={`${emp.empCode} · ${emp.designationRef?.name ?? emp.designation ?? "—"}`} />
      <div className="p-margin">
        <LearnerDetail
          employeeId={emp.id}
          canEdit={canApproveHr(perms)}
          enrolment={
            emp.salesTrainingLearner
              ? {
                  active: emp.salesTrainingLearner.active,
                  enrolledAt: emp.salesTrainingLearner.enrolledAt.toISOString(),
                  dueDate: emp.salesTrainingLearner.dueDate?.toISOString().slice(0, 10) ?? null,
                }
              : null
          }
          summary={{ ...s, lastActivity: s.lastActivity?.toISOString() ?? null }}
          modules={relevant.map((m) => {
            const p = progress.get(m.id)!;
            return {
              id: m.id,
              title: m.title,
              archived: m.status === "archived",
              passMark: m.passMark,
              maxAttempts: m.maxAttempts,
              status: p.status,
              attemptsUsed: p.attempts,
              bestPercent: p.bestPercent,
              videosDone: p.videosDone,
              videosTotal: p.videosTotal,
              attempts: attempts
                .filter((a) => a.moduleId === m.id)
                .map((a) => ({
                  id: a.id,
                  submittedAt: a.submittedAt.toISOString(),
                  score: a.score,
                  maxScore: a.maxScore,
                  percent: a.percent,
                  passed: a.passed,
                  voided: !!a.voidedAt,
                  graded: a.graded as unknown as GradedQuestion[],
                })),
            };
          })}
        />
      </div>
    </>
  );
}
