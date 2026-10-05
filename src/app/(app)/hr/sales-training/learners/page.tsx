import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { NoAccess } from "@/components/sales-training/ui";
import { loadProgress, summarise } from "@/lib/sales-training-db";
import { LearnersClient } from "./client";

export const dynamic = "force-dynamic";

export default async function SalesTrainingLearnersPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) return <NoAccess title="Learners" />;

  const [employees, learners, modules] = await Promise.all([
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        empCode: true,
        userId: true,
        designation: true,
        department: true,
        designationRef: { select: { name: true } },
      },
    }),
    prisma.salesTrainingLearner.findMany({ orderBy: { enrolledAt: "desc" } }),
    prisma.salesTrainingModule.findMany({
      where: { status: "published" },
      orderBy: { sortOrder: "asc" },
      select: { id: true, videos: true, maxAttempts: true },
    }),
  ]);
  const empById = new Map(employees.map((e) => [e.id, e]));
  const progress = await loadProgress(modules, learners.map((l) => l.employeeId));
  const enrolled = new Set(learners.filter((l) => l.active).map((l) => l.employeeId));

  return (
    <>
      <TopBar title="Learners" subtitle="Who is enrolled in Sales Consultant Training" />
      <div className="p-margin">
        <LearnersClient
          canEdit={canApproveHr(perms)}
          candidates={employees
            .filter((e) => !enrolled.has(e.id))
            .map((e) => ({
              id: e.id,
              name: e.name,
              empCode: e.empCode,
              designation: e.designationRef?.name ?? e.designation ?? "",
              department: e.department ?? "",
              hasLogin: !!e.userId,
            }))}
          learners={learners.map((l) => {
              const e = empById.get(l.employeeId);
              const s = summarise(modules.map((m) => progress.get(l.employeeId)!.get(m.id)!));
              return {
                employeeId: l.employeeId,
                name: e?.name ?? "(left the company)",
                empCode: e?.empCode ?? "",
                designation: e?.designationRef?.name ?? e?.designation ?? "",
                hasLogin: !!e?.userId,
                active: l.active,
                dueDate: l.dueDate ? l.dueDate.toISOString().slice(0, 10) : null,
                enrolledAt: l.enrolledAt.toISOString(),
                passed: s.passed,
                total: s.total,
                avgScore: s.avgScore,
                lastActivity: s.lastActivity ? s.lastActivity.toISOString() : null,
              };
            })}
        />
      </div>
    </>
  );
}
