import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { DateFilter } from "@/components/DateFilter";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isAdmin } from "@/lib/rbac";
import { parsePeriod, rangeFor, periodLabel } from "@/lib/period";
import { getModuleUsageMatrix, getCrmUsageByUser, moduleLabel } from "@/lib/usage-metrics";
import { formatActiveTime } from "@/lib/usage-tracking";
import { MODULES } from "@/lib/modules";

export const dynamic = "force-dynamic";

type SP = { [k: string]: string | string[] | undefined };

function str(sp: SP, k: string): string | undefined {
  const v = sp[k];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** CRM sub-page href → its sidebar label, for the CRM breakdown table. */
const CRM_PAGE_LABEL: Record<string, string> = Object.fromEntries(
  (MODULES.find((m) => m.id === "crm")?.pages ?? []).map((p) => [p.href, p.label]),
);
function crmPageLabel(href: string): string {
  return CRM_PAGE_LABEL[href] ?? href.replace(/^\/crm\//, "");
}

export default async function UsagePage({ searchParams }: { searchParams: SP }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) redirect("/login");
  if (!isAdmin(perms)) {
    return (
      <>
        <TopBar title="Usage" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              You need admin access to view this page.
            </div>
          </Section>
        </div>
      </>
    );
  }

  const period = parsePeriod({
    period: str(searchParams, "period"),
    from: str(searchParams, "from"),
    to: str(searchParams, "to"),
  });
  const range = rangeFor(period);
  const rangeText = periodLabel(period);

  const [matrix, crmUsage] = await Promise.all([
    getModuleUsageMatrix(range),
    getCrmUsageByUser(range),
  ]);

  const activeUsers = matrix.rows.length;
  const busiestModuleId = Object.entries(matrix.columnTotals).sort((a, b) => b[1] - a[1])[0]?.[0];

  // CRM sub-page breakdown, busiest consultant first.
  const crmRows = [...crmUsage.values()]
    .map((r) => ({
      ...r,
      displayName: matrix.rows.find((m) => m.userId === r.userId)?.displayName ?? r.userId,
      topPages: Object.entries(r.byPage).sort((a, b) => b[1] - a[1]),
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds || a.displayName.localeCompare(b.displayName));

  return (
    <>
      <TopBar title="Usage" subtitle="Active time per module — real engagement, not open tabs" />
      <div className="p-margin space-y-lg">
        <div className="flex flex-wrap items-center justify-between gap-base">
          <p className="text-label-sm text-on-surface-variant">
            Active time for <span className="font-semibold text-on-surface">{rangeText}</span>. Counts only
            time with the tab focused and the user interacting — idle or background tabs are excluded.
          </p>
          <DateFilter />
        </div>

        <section className="grid grid-cols-2 gap-gutter md:grid-cols-4">
          <KpiCard label="Total active time" value={formatActiveTime(matrix.grandTotal)} hint={rangeText} tone="primary" />
          <KpiCard label="Active users" value={String(activeUsers)} hint="With recorded engagement" />
          <KpiCard
            label="Busiest module"
            value={busiestModuleId ? moduleLabel(busiestModuleId) : "—"}
            hint={busiestModuleId ? formatActiveTime(matrix.columnTotals[busiestModuleId]) : rangeText}
            tone="success"
          />
          <KpiCard
            label="CRM active time"
            value={formatActiveTime(matrix.columnTotals["crm"] ?? 0)}
            hint={rangeText}
          />
        </section>

        {/* Users × modules matrix */}
        <Section
          title="Active time by user & module"
          action={<span className="text-caption text-on-surface-variant">Busiest first · {rangeText}</span>}
        >
          {matrix.rows.length === 0 ? (
            <p className="py-md text-center text-on-surface-variant text-label-sm">
              No engagement recorded for {rangeText} yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-label-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-left text-caption uppercase tracking-wider text-on-surface-variant">
                    <th className="py-sm pr-sm font-semibold">User</th>
                    {matrix.moduleIds.map((id) => (
                      <th key={id} className="px-sm py-sm text-right font-semibold">
                        {moduleLabel(id)}
                      </th>
                    ))}
                    <th className="pl-sm py-sm text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((r) => (
                    <tr key={r.userId} className="border-b border-outline-variant/60 hover:bg-surface-container-low">
                      <td className="py-sm pr-sm">
                        <span className="font-medium text-on-surface">{r.displayName}</span>
                        {r.role && <span className="ml-xs text-caption uppercase text-on-surface-variant">{r.role}</span>}
                      </td>
                      {matrix.moduleIds.map((id) => (
                        <td key={id} className="px-sm py-sm text-right tabular-nums text-on-surface-variant">
                          {r.perModule[id] ? formatActiveTime(r.perModule[id]) : "·"}
                        </td>
                      ))}
                      <td className="pl-sm py-sm text-right font-semibold tabular-nums">{formatActiveTime(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-outline-variant text-caption font-semibold text-on-surface-variant">
                    <td className="py-sm pr-sm uppercase tracking-wider">All users</td>
                    {matrix.moduleIds.map((id) => (
                      <td key={id} className="px-sm py-sm text-right tabular-nums">
                        {formatActiveTime(matrix.columnTotals[id] ?? 0)}
                      </td>
                    ))}
                    <td className="pl-sm py-sm text-right tabular-nums">{formatActiveTime(matrix.grandTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Section>

        {/* CRM sub-page breakdown */}
        <Section
          title="CRM — where the time goes"
          action={
            <Link href="/crm/team" className="text-caption font-semibold text-primary hover:underline">
              Full CRM engagement →
            </Link>
          }
        >
          {crmRows.length === 0 ? (
            <p className="py-md text-center text-on-surface-variant text-label-sm">
              No CRM engagement recorded for {rangeText} yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-label-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-left text-caption uppercase tracking-wider text-on-surface-variant">
                    <th className="py-sm pr-sm font-semibold">Consultant</th>
                    <th className="px-sm py-sm text-right font-semibold">CRM active time</th>
                    <th className="pl-sm py-sm text-left font-semibold">By page</th>
                  </tr>
                </thead>
                <tbody>
                  {crmRows.map((r) => (
                    <tr key={r.userId} className="border-b border-outline-variant/60 hover:bg-surface-container-low">
                      <td className="py-sm pr-sm font-medium text-on-surface">{r.displayName}</td>
                      <td className="px-sm py-sm text-right font-semibold tabular-nums">
                        {formatActiveTime(r.totalSeconds)}
                      </td>
                      <td className="pl-sm py-sm text-left text-caption text-on-surface-variant">
                        {r.topPages.map(([href, secs]) => `${crmPageLabel(href)} ${formatActiveTime(secs)}`).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
