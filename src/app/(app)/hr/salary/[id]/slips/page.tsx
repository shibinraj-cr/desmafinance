import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, canDownloadAxis } from "@/lib/hr-rbac";
import { loadSlipPayloadsForRun } from "@/lib/hr-salary-slip";
import { SalarySlip } from "@/components/SalarySlip";
import { PrintButton } from "@/components/PrintButton";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function BulkSlipsPage({ params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canApproveHr(perms) && !canDownloadAxis(perms)) {
    return (
      <div className="p-margin">
        <p className="text-center text-on-surface-variant py-lg">
          You don&apos;t have permission to generate bulk salary slips.
        </p>
      </div>
    );
  }
  const run = await prisma.hrSalaryRun.findUnique({ where: { id: params.id } });
  if (!run) notFound();
  const slips = await loadSlipPayloadsForRun(params.id);

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: "salary_slip_bulk_viewed",
      entityType: "HrSalaryRun",
      entityId: params.id,
      metadata: { runId: params.id, count: slips.length },
    },
  });

  return (
    <main className="min-h-screen bg-gray-200 print:bg-white py-8 print:py-0">
      <div className="max-w-[820px] mx-auto mb-4 px-4 print:hidden flex items-center justify-between">
        <Link href={`/hr/salary/${params.id}`} className="text-sm underline text-on-surface-variant">
          ← Back to run
        </Link>
        <div className="text-sm text-on-surface-variant">
          {slips.length} slip{slips.length === 1 ? "" : "s"} · {run.monthKey}
        </div>
        <PrintButton label="Download all (PDF)" />
      </div>
      {slips.map((p) => (
        <div key={p.meta.lineId} className="mb-4">
          <SalarySlip payload={p} />
        </div>
      ))}
    </main>
  );
}
