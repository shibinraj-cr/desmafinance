import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { getServiceConversionMatrix } from "@/lib/lead-pulse-metrics";
import { todayIst } from "@/lib/lead-pulse-dates";
import { TargetsMatrix } from "./client";

export const dynamic = "force-dynamic";

/**
 * Service-conversion targets vs actuals for L2 BDEs. Supervisor-only.
 * Suhaina is the primary editor of this page (per spec).
 */
export default async function TargetsPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
          }}
        >
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            Only supervisors and admins can set monthly L2 BDE targets.
          </p>
        </div>
      </div>
    );
  }

  const today = todayIst();
  const year = searchParams.year ? Number(searchParams.year) : Number(today.slice(0, 4));
  const month = searchParams.month ? Number(searchParams.month) : Number(today.slice(5, 7));
  const matrix = await getServiceConversionMatrix(year, month);

  // Convert the cells Map into a plain payload the client can use.
  const cellsObj: Record<string, { target: number; actual: number; partyNames: string[] }> = {};
  for (const [k, v] of matrix.cells) cellsObj[k] = v;

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">L2 Service Targets</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {monthLabel} · {matrix.bdes.length} BDE{matrix.bdes.length === 1 ? "" : "s"} ·{" "}
            {matrix.services.length} service{matrix.services.length === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      <form
        action="/marketing/lead-pulse/targets"
        method="get"
        className="flex flex-wrap items-center gap-[8px] rounded-[12px] p-[12px] border"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <Select
          name="year"
          defaultValue={String(year)}
          options={[year - 1, year, year + 1].map((y) => [String(y), String(y)] as const)}
        />
        <Select
          name="month"
          defaultValue={String(month)}
          options={[
            ["1", "Jan"], ["2", "Feb"], ["3", "Mar"], ["4", "Apr"], ["5", "May"], ["6", "Jun"],
            ["7", "Jul"], ["8", "Aug"], ["9", "Sep"], ["10", "Oct"], ["11", "Nov"], ["12", "Dec"],
          ]}
        />
        <button
          type="submit"
          className="h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold"
          style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
        >
          Apply
        </button>
      </form>

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

function Select({
  name,
  defaultValue,
  options,
}: {
  name: string;
  defaultValue: string;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <select name={name} defaultValue={defaultValue} className="h-[36px] px-[10px] rounded-[8px] text-[13px]">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
