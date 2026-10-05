import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { NoAccess } from "@/components/sales-training/ui";
import { toVideos } from "@/lib/sales-training-db";
import { ModulesClient } from "./client";

export const dynamic = "force-dynamic";

export default async function SalesTrainingModulesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) return <NoAccess title="Training Modules" />;

  const [modules, passes] = await Promise.all([
    prisma.salesTrainingModule.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { questions: true } } },
    }),
    prisma.salesTrainingAttempt.groupBy({
      by: ["moduleId", "employeeId"],
      where: { voidedAt: null, passed: true },
    }),
  ]);
  const passCount = new Map<string, number>();
  for (const p of passes) passCount.set(p.moduleId, (passCount.get(p.moduleId) ?? 0) + 1);

  return (
    <>
      <TopBar title="Training Modules" subtitle="Videos + quiz per module, in curriculum order" />
      <div className="p-margin">
        <ModulesClient
          canEdit={canApproveHr(perms)}
          modules={modules.map((m) => ({
            id: m.id,
            title: m.title,
            description: m.description,
            status: m.status,
            videos: toVideos(m.videos).length,
            thumb: toVideos(m.videos)[0]?.youtubeId ?? null,
            questions: m._count.questions,
            passMark: m.passMark,
            maxAttempts: m.maxAttempts,
            passed: passCount.get(m.id) ?? 0,
          }))}
        />
      </div>
    </>
  );
}
