import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { loadEmployeeSlip } from "@/lib/hr-salary-slip";
import { SalarySlip } from "@/components/SalarySlip";
import { PrintButton } from "@/components/PrintButton";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function MyPayslipPage({ params }: { params: { id: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");
  const emp = await employeeForUser(userId);
  if (!emp) {
    return (
      <main className="p-margin">
        <p className="text-center text-on-surface-variant py-lg">
          Your login isn&apos;t linked to an employee record. Ask HR to link your account.
        </p>
      </main>
    );
  }
  const run = await prisma.hrSalaryRun.findUnique({ where: { id: params.id } });
  if (!run) notFound();
  // ESS: employees can only see slips for approved (or axis-exported) runs.
  if (run.status === "draft") {
    return (
      <main className="p-margin">
        <p className="text-center text-on-surface-variant py-lg">
          This payroll run hasn&apos;t been approved yet. Check back once HR signs off.
        </p>
      </main>
    );
  }
  const payload = await loadEmployeeSlip(emp.id, run.id);
  if (!payload) notFound();

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "self_payslip_viewed",
      entityType: "HrSalaryRunLine",
      entityId: payload.meta.lineId,
      metadata: { runId: run.id, monthKey: run.monthKey },
    },
  });

  return (
    <main className="min-h-screen bg-gray-200 print:bg-white py-8 print:py-0">
      <div className="max-w-[820px] mx-auto mb-4 px-4 print:hidden flex items-center justify-between">
        <Link href="/me/payslips" className="text-sm underline text-on-surface-variant">
          ← Back to payslips
        </Link>
        <PrintButton />
      </div>
      <SalarySlip payload={payload} />
    </main>
  );
}
