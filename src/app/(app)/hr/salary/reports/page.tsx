import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canViewStatutoryReports } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getStatutoryReportData } from "@/lib/hr-statutory-reports-data";
import { StatutoryReportsClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * HR → Payroll → Statutory Reports.
 *
 * Monthly PF (ECR) and ESI return sheets generated from a computed salary
 * run's frozen lines, in the exact layouts uploaded to the EPFO / ESIC
 * portals. HR Manager + Admin only (deliberately narrower than the payroll
 * pages Finance Manager can see).
 */
export default async function StatutoryReportsPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canViewStatutoryReports(perms)) {
    return (
      <>
        <TopBar title="Statutory Reports" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }

  const runs = await prisma.hrSalaryRun.findMany({
    select: { id: true, monthKey: true, status: true },
    orderBy: { monthKey: "desc" },
  });
  const selected =
    runs.find((r) => r.monthKey === searchParams.month) ??
    runs.find((r) => r.status !== "draft") ??
    runs[0] ??
    null;
  const data = selected ? await getStatutoryReportData(selected.id) : null;

  return (
    <>
      <TopBar
        title="Statutory Reports"
        subtitle="Monthly PF (ECR) and ESI return sheets, generated from the computed salary run"
      />
      <div className="p-margin">
        {runs.length === 0 || !data ? (
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              No salary runs yet — compute a salary run first.
            </div>
          </Section>
        ) : (
          <StatutoryReportsClient
            runs={runs.map((r) => ({ monthKey: r.monthKey, status: r.status }))}
            data={data}
          />
        )}
      </div>
    </>
  );
}
