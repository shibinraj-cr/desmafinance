import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, canDownloadAxis } from "@/lib/hr-rbac";
import { loadSlipPayload } from "@/lib/hr-salary-slip";
import { SalarySlip } from "@/components/SalarySlip";
import { PrintButton } from "@/components/PrintButton";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function SlipPage({
  params,
}: {
  params: { id: string; lineId: string };
}) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canApproveHr(perms) && !canDownloadAxis(perms)) {
    return (
      <div className="p-margin">
        <p className="text-center text-on-surface-variant py-lg">
          You don&apos;t have permission to view individual salary slips.
        </p>
      </div>
    );
  }
  const payload = await loadSlipPayload(params.id, params.lineId);
  if (!payload) notFound();

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: "salary_slip_viewed",
      entityType: "HrSalaryRunLine",
      entityId: params.lineId,
      metadata: { runId: params.id, empCode: payload.employee.empCode },
    },
  });

  return (
    <main className="min-h-screen bg-gray-200 print:bg-white py-8 print:py-0">
      <div className="max-w-[820px] mx-auto mb-4 px-4 print:hidden flex items-center justify-between">
        <Link href={`/hr/salary/${params.id}`} className="text-sm underline text-on-surface-variant">
          ← Back to run
        </Link>
        <PrintButton />
      </div>
      <SalarySlip payload={payload} />
    </main>
  );
}
