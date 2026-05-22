import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr, canDownloadAxis } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { monthKeyFromDate } from "@/lib/hr-data";
import { SalaryRunsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function SalaryRunsPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms) && !canDownloadAxis(perms)) {
    return (
      <>
        <TopBar title="Salary Runs" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }
  const runs = await prisma.hrSalaryRun.findMany({
    orderBy: { monthKey: "desc" },
    include: { _count: { select: { lines: true } } },
  });
  const todayMonth = monthKeyFromDate(new Date());
  return (
    <>
      <TopBar title="Salary Runs" subtitle={`Current month: ${todayMonth}`} />
      <div className="p-margin">
        <SalaryRunsClient
          runs={runs.map((r) => ({
            id: r.id,
            monthKey: r.monthKey,
            status: r.status,
            workingDaysBase: r.workingDaysBase,
            totalNet: Number(r.totalNet),
            approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
            axisExportName: r.axisExportName,
            axisExportedAt: r.axisExportedAt ? r.axisExportedAt.toISOString() : null,
            lineCount: r._count.lines,
          }))}
          currentMonth={todayMonth}
          canCompute={canApproveHr(perms)}
          canApprove={canApproveHr(perms)}
          canDownload={canDownloadAxis(perms)}
        />
      </div>
    </>
  );
}
