import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr, canDownloadAxis } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { SalaryRunDetail } from "./client";

export const dynamic = "force-dynamic";

export default async function SalaryRunDetailPage({ params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms) && !canDownloadAxis(perms)) {
    return (
      <>
        <TopBar title="Salary Run" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }
  const run = await prisma.hrSalaryRun.findUnique({
    where: { id: params.id },
    include: {
      lines: {
        include: { employee: { select: { empCode: true, name: true } } },
        orderBy: { employee: { empCode: "asc" } },
      },
      adjustments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) notFound();

  // Itemised adjustments are keyed by (run, employee); group them so each line
  // carries its own rows.
  const adjByEmployee = new Map<string, typeof run.adjustments>();
  for (const a of run.adjustments) {
    const list = adjByEmployee.get(a.employeeId);
    if (list) list.push(a);
    else adjByEmployee.set(a.employeeId, [a]);
  }
  return (
    <>
      <TopBar
        title={`Salary Run · ${run.monthKey}`}
        subtitle={`${run.status.replace("_", " ")} · ${run.lines.length} line${run.lines.length === 1 ? "" : "s"}`}
        action={
          <Link href="/hr/salary" className="text-label-sm underline">
            ← Back
          </Link>
        }
      />
      <div className="p-margin">
        <SalaryRunDetail
          run={{
            id: run.id,
            monthKey: run.monthKey,
            status: run.status,
            workingDaysBase: run.workingDaysBase,
            totalNet: Number(run.totalNet),
            approvedAt: run.approvedAt ? run.approvedAt.toISOString() : null,
            axisExportedAt: run.axisExportedAt ? run.axisExportedAt.toISOString() : null,
          }}
          lines={run.lines.map((l) => ({
            id: l.id,
            employeeId: l.employeeId,
            empCode: l.employee.empCode,
            name: l.employee.name,
            daysAttended: Number(l.daysAttended),
            totalLeaveForLop: Number(l.totalLeaveForLop),
            paidLeave: Number(l.paidLeave),
            unpaidLeave: Number(l.unpaidLeave),
            halfDayLeave: Number(l.halfDayLeave),
            monthlySalary: Number(l.monthlySalary),
            basicAfterLop: Number(l.basicAfterLop),
            salaryBeforeEsi: Number(l.salaryBeforeEsi),
            esiEmployee: Number(l.esiEmployee),
            pfEmployee: Number(l.pfEmployee),
            professionalTax: Number(l.professionalTax),
            adjustments: Number(l.adjustments),
            adjustmentRows: (adjByEmployee.get(l.employeeId) ?? []).map((a) => ({
              id: a.id,
              kind: a.kind,
              category: a.category,
              amount: Number(a.amount),
              note: a.note,
            })),
            netSalary: Number(l.netSalary),
            bankAccount: l.bankAccount,
            bankIfsc: l.bankIfsc,
            bankName: l.bankName,
          }))}
          canEdit={canApproveHr(perms) && run.status === "draft"}
          canApprove={canApproveHr(perms) && run.status === "draft"}
          canDownload={canDownloadAxis(perms) && run.status !== "draft"}
        />
      </div>
    </>
  );
}
