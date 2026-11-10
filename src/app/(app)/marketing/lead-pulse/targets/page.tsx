import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { resolveServiceMatrix } from "@/lib/lead-pulse-crm-metrics";
import { MonthForm, SheetTabs, SupervisorOnly, monthLabel, sheetMonth } from "./_sheet";
import { TargetsMatrix } from "./client";

export const dynamic = "force-dynamic";

/**
 * Service-conversion targets vs actuals for L2 BDEs. Supervisor-only. The first
 * tab of the L2 target sheet; Minimum & slabs and Teams sit beside it.
 */
export default async function TargetsPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) return <SupervisorOnly />;

  const { year, month } = sheetMonth(searchParams);
  const matrix = await resolveServiceMatrix(year, month);

  // Convert the cells Map into a plain payload the client can use.
  const cellsObj: Record<string, { target: number; actual: number; partyNames: string[] }> = {};
  for (const [k, v] of matrix.cells) cellsObj[k] = v;

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">L2 Targets &amp; Incentive</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {monthLabel(year, month)} · {matrix.bdes.length} active L2 BDE{matrix.bdes.length === 1 ? "" : "s"} ·{" "}
            {matrix.services.length} service{matrix.services.length === 1 ? "" : "s"} on the matrix
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <SheetTabs active="service" year={year} month={month} />
          <a
            href="/marketing/lead-pulse/targets/services"
            className="h-[36px] inline-flex items-center px-[14px] rounded-[8px] border text-[13px] font-semibold"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
          >
            Manage services
          </a>
        </div>
      </header>

      <MonthForm action="/marketing/lead-pulse/targets" year={year} month={month} />

      {matrix.bdes.length === 0 || matrix.services.length === 0 ? (
        <div
          className="rounded-[12px] p-[24px] border text-center"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
            color: "var(--lp-on-surface-variant)",
          }}
        >
          {matrix.bdes.length === 0
            ? "No active L2 BDEs found. Add one via Team Roster."
            : "No services found. Either no L2 BDEs have candidates with services assigned, or no targets have been set for this month yet."}
        </div>
      ) : (
        <TargetsMatrix
          year={year}
          month={month}
          bdes={matrix.bdes}
          services={matrix.services}
          cells={cellsObj}
        />
      )}
    </div>
  );
}

