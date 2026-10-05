import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { NoAccess } from "@/components/sales-training/ui";
import { youTubeWatchUrl } from "@/lib/sales-training";
import { toQuestion, toVideos } from "@/lib/sales-training-db";
import { ModuleEditor } from "./client";

export const dynamic = "force-dynamic";

export default async function SalesTrainingModulePage({ params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) return <NoAccess title="Training Module" />;

  const mod = await prisma.salesTrainingModule.findUnique({
    where: { id: params.id },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  });
  if (!mod) notFound();

  const attempts = await prisma.salesTrainingAttempt.findMany({
    where: { moduleId: mod.id, voidedAt: null },
    orderBy: { submittedAt: "desc" },
    select: {
      employeeId: true,
      percent: true,
      passed: true,
      submittedAt: true,
      employee: { select: { name: true, empCode: true } },
    },
  });
  const byEmp = new Map<string, { name: string; empCode: string; attempts: number; best: number; passed: boolean; last: string }>();
  for (const a of attempts) {
    const r = byEmp.get(a.employeeId);
    if (!r) {
      byEmp.set(a.employeeId, {
        name: a.employee.name,
        empCode: a.employee.empCode,
        attempts: 1,
        best: a.percent,
        passed: a.passed,
        last: a.submittedAt.toISOString(),
      });
    } else {
      r.attempts++;
      r.best = Math.max(r.best, a.percent);
      r.passed ||= a.passed;
    }
  }

  return (
    <>
      <TopBar title={mod.title} subtitle="Training module" />
      <div className="p-margin">
        <ModuleEditor
          canEdit={canApproveHr(perms)}
          hasAttempts={attempts.length > 0}
          module={{
            id: mod.id,
            title: mod.title,
            description: mod.description ?? "",
            passMark: mod.passMark,
            maxAttempts: mod.maxAttempts,
            requireWatch: mod.requireWatch,
            status: mod.status,
            videos: toVideos(mod.videos).map((v) => ({ id: v.id, title: v.title, url: youTubeWatchUrl(v.youtubeId) })),
          }}
          questions={mod.questions.map(toQuestion)}
          results={[...byEmp.entries()].map(([employeeId, r]) => ({ employeeId, ...r }))}
        />
      </div>
    </>
  );
}
