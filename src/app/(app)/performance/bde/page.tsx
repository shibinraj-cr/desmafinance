import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { DateFilter } from "@/components/DateFilter";
import { EmptyNote, PerformanceNoAccess, numCls, tdCls, thCls } from "@/components/PerformanceUi";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canViewTeamPerformancePage, TP_BDE } from "@/lib/team-performance-rbac";
import { getBdeSummary, resolveRange, type BdeRow } from "@/lib/team-performance";

export const dynamic = "force-dynamic";

function Table({ rows, l2 }: { rows: BdeRow[]; l2: boolean }) {
  if (rows.length === 0) return <EmptyNote>No entries in this period.</EmptyNote>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className={thCls}>BDE</th>
            <th className={thCls + numCls}>Leads</th>
            <th className={thCls + numCls}>{l2 ? "Enrolled" : "To L2"}</th>
            <th className={thCls + numCls}>Conversion</th>
            {l2 && <th className={thCls}>Target progress</th>}
            <th className={thCls + numCls}>Answered calls</th>
            <th className={thCls + numCls}>Talk time</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const pct = b.target ? Math.min(Math.round((b.won / b.target) * 100), 100) : null;
            return (
              <tr key={b.userId}>
                <td className={tdCls + " font-semibold"}>{b.name}</td>
                <td className={tdCls + numCls}>{b.leads}</td>
                <td className={tdCls + numCls}>{b.won}</td>
                <td className={tdCls + numCls}>{b.conversionPct == null ? "–" : `${b.conversionPct}%`}</td>
                {l2 && (
                  <td className={tdCls}>
                    {pct == null ? (
                      <span className="text-on-surface-variant">No target set</span>
                    ) : (
                      <div className="flex items-center gap-base">
                        <div className="w-28 h-2 bg-surface-container rounded overflow-hidden">
                          <div className={"h-full rounded " + (pct >= 80 ? "bg-green-600" : "bg-primary-container")} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="font-mono text-label-sm">{b.won} / {b.target}</span>
                      </div>
                    )}
                  </td>
                )}
                <td className={tdCls + numCls}>{b.calls}</td>
                <td className={tdCls + numCls}>{b.talkMin ? `${Math.floor(b.talkMin / 60)}h ${b.talkMin % 60}m` : "–"}</td>
                <td className={tdCls}>
                  <Link className="text-label-sm text-accent" href={`/marketing/lead-pulse/bde-performance/${b.userId}`}>
                    Details →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function BdePerformancePage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canViewTeamPerformancePage(perms, TP_BDE)) return <PerformanceNoAccess title="BDE Performance" />;

  const range = resolveRange(searchParams);
  const rows = await getBdeSummary(range);
  const l2 = rows.filter((r) => r.role === "l2").sort((a, b) => b.won - a.won);
  const l1 = rows.filter((r) => r.role === "l1").sort((a, b) => b.won - a.won);

  return (
    <>
      <TopBar title="BDE Performance" subtitle={range.label} action={<DateFilter />} />
      <div className="p-margin space-y-lg">
        <Section title="L2 BDEs · enrolments">
          <Table rows={l2} l2 />
        </Section>
        <Section title="L1 BDEs · transfers to L2">
          <Table rows={l1} l2={false} />
        </Section>
        <p className="text-caption text-on-surface-variant">
          Leads and conversions from submitted Lead Pulse entries; targets from L2 Targets; calls from Voxbay, matched to the BDE by first name.
        </p>
      </div>
    </>
  );
}
