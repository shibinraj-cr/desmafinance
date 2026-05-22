import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { TrainingsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HrTrainingsPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Trainings" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }
  const trainings = await prisma.hrTraining.findMany({
    orderBy: { updatedAt: "desc" },
    include: { progress: { include: { employee: { select: { name: true, empCode: true } } } } },
  });
  return (
    <>
      <TopBar title="Trainings" />
      <div className="p-margin">
        <TrainingsClient
          trainings={trainings.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            videoUrl: t.videoUrl,
            passingScore: t.passingScore,
            status: t.status,
            quiz: (t.quiz as unknown as { id: string; prompt: string; choices: string[]; correctIndex: number }[]) ?? [],
            progress: t.progress.map((p) => ({
              empCode: p.employee.empCode,
              name: p.employee.name,
              score: p.score,
              passed: p.passed,
              attempts: p.attempts,
              completedAt: p.completedAt ? p.completedAt.toISOString() : null,
            })),
          }))}
          canEdit={canApproveHr(perms)}
        />
      </div>
    </>
  );
}
