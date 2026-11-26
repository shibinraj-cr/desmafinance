import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { DateFilter } from "@/components/DateFilter";
import { DailyQueriesChart, ShareBars } from "@/components/PerformanceCharts";
import { EmptyNote, PerformanceNoAccess, PerformerCard, numCls, tdCls, thCls } from "@/components/PerformanceUi";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canViewTeamPerformance } from "@/lib/team-performance-rbac";
import {
  getBdeSummary,
  getDailySeries,
  getStaffSummary,
  getUnanswered,
  resolveRange,
} from "@/lib/team-performance";

export const dynamic = "force-dynamic";

export default async function PerformanceOverviewPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canViewTeamPerformance(perms)) return <PerformanceNoAccess title="Team Performance" />;

  const range = resolveRange(searchParams);
  const [support, days, unanswered, bdes] = await Promise.all([
    getStaffSummary(range),
    getDailySeries(range),
    getUnanswered(range),
    getBdeSummary(range),
  ]);

  const missed = unanswered.length;
  const done = support.rows.reduce((a, r) => a + r.closuresDone, 0);
  const needed = support.rows.reduce((a, r) => a + r.closuresNeeded, 0);
  const offDaysCovered = days.filter((d) => d.offDay && d.answered > 0).length;
  const offDays = days.filter((d) => d.offDay).length;

  const topResponder = support.rows[0] ?? null;
  const bestQuality =
    [...support.rows]
      .filter((r) => r.quality != null && r.queries >= 10)
      .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0))[0] ?? null;

  const l2 = bdes.filter((b) => b.role === "l2");
  const topBde = [...l2].sort((a, b) => b.won - a.won)[0] ?? null;
  const l2Leads = l2.reduce((a, b) => a + b.leads, 0);
  const l2Won = l2.reduce((a, b) => a + b.won, 0);
  const l2Target = l2.reduce((a, b) => a + (b.target ?? 0), 0);
  const calls = bdes.reduce((a, b) => a + b.calls, 0);
  const talkH = Math.round(bdes.reduce((a, b) => a + b.talkMin, 0) / 60);

  const qp = new URLSearchParams(
    Object.entries(searchParams).filter((e): e is [string, string] => typeof e[1] === "string"),
  ).toString();
  const qs = qp ? `?${qp}` : "";

  return (
    <>
      <TopBar title="Team Performance" subtitle={range.label} action={<DateFilter />} />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
          <PerformerCard
            kicker="Candidate support · top responder"
            name={topResponder?.staff ?? null}
            detail={topResponder ? `${topResponder.queries} after-hours first replies · ${topResponder.sharePct}% of all` : "Waiting for the first WhatsApp report"}
            href={`/performance/candidate-support${qs}`}
          />
          <PerformerCard
            kicker="Candidate support · best reply quality"
            name={bestQuality?.staff ?? null}
            detail={bestQuality ? `${bestQuality.quality?.toFixed(1)} / 10 average · min 10 replies` : "Needs at least 10 scored replies"}
            href={`/performance/candidate-support${qs}`}
          />
          <PerformerCard
            kicker="Sales · top L2 BDE"
            name={topBde?.name ?? null}
            detail={topBde ? `${topBde.won} enrolled${topBde.target ? ` of ${topBde.target} target` : ""} · ${topBde.conversionPct ?? 0}% conversion` : "No Lead Pulse entries in this period"}
            href={`/performance/bde${qs}`}
          />
        </section>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-gutter">
          <KpiCard label="After-hours queries answered" value={String(support.total)} hint="Candidate WhatsApp groups" />
          <KpiCard label="No reply by 9 AM" value={String(missed)} tone={missed > 0 ? "danger" : "success"} hint="See Unanswered Queries" />
          <KpiCard
            label="“Will update” promises kept"
            value={needed ? `${Math.round((done / needed) * 100)}%` : "–"}
            hint={`${done} of ${needed} followed up`}
          />
          <KpiCard label="Sundays & holidays covered" value={`${offDaysCovered} / ${offDays}`} hint="From the HR holiday calendar" />
          <KpiCard label="L2 leads" value={String(l2Leads)} hint="Lead Pulse, submitted entries" />
          <KpiCard
            label="L2 enrolled vs target"
            value={l2Target ? `${l2Won} / ${l2Target}` : String(l2Won)}
            tone="primary"
            hint={l2Leads ? `${Math.round((l2Won / l2Leads) * 1000) / 10}% conversion` : undefined}
          />
          <KpiCard label="Answered calls" value={calls.toLocaleString("en-IN")} hint={`${talkH} h talk time · Voxbay`} />
          <KpiCard label="Active BDEs" value={String(bdes.length)} hint={`${l2.length} L2 · ${bdes.length - l2.length} L1`} />
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-gutter">
          <Section title="After-hours candidate queries per day" className="xl:col-span-3">
            {support.total === 0 && missed === 0 ? (
              <EmptyNote>No WhatsApp scores for this period yet.</EmptyNote>
            ) : (
              <>
                <DailyQueriesChart data={days} />
                <p className="text-caption text-on-surface-variant mt-sm">
                  6 PM to 9:30 AM next day · Sundays and holidays all day (bold dates, darker bars).
                </p>
              </>
            )}
          </Section>
          <Section title="Who answers after hours" className="xl:col-span-2">
            {support.rows.length === 0 ? (
              <EmptyNote>No data yet.</EmptyNote>
            ) : (
              <ShareBars
                data={support.rows.filter((r) => r.queries > 0).map((r) => ({ name: r.staff, value: r.queries, pct: Math.round(r.sharePct) }))}
              />
            )}
          </Section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-gutter">
          <Section
            title="BDE snapshot"
            action={<Link href={`/performance/bde${qs}`} className="text-label-sm text-accent">All BDEs →</Link>}
          >
            {bdes.length === 0 ? (
              <EmptyNote>No Lead Pulse entries in this period.</EmptyNote>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thCls}>BDE</th>
                      <th className={thCls + numCls}>Leads</th>
                      <th className={thCls + numCls}>Won</th>
                      <th className={thCls + numCls}>Conv.</th>
                      <th className={thCls + numCls}>Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bdes.slice(0, 8).map((b) => (
                      <tr key={b.userId}>
                        <td className={tdCls + " font-semibold"}>
                          {b.name} <span className="text-caption text-on-surface-variant uppercase">{b.role}</span>
                        </td>
                        <td className={tdCls + numCls}>{b.leads}</td>
                        <td className={tdCls + numCls}>{b.won}</td>
                        <td className={tdCls + numCls}>{b.conversionPct == null ? "–" : `${b.conversionPct}%`}</td>
                        <td className={tdCls + numCls}>{b.calls}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section
            title="Needs attention"
            action={<Link href={`/performance/unanswered${qs}`} className="text-label-sm text-accent">All unanswered →</Link>}
          >
            {unanswered.length === 0 ? (
              <EmptyNote>Every candidate query got a reply by 9 AM.</EmptyNote>
            ) : (
              <ul className="space-y-sm">
                {unanswered.slice(0, 6).map((u) => (
                  <li key={u.id} className="border border-outline-variant rounded-lg px-md py-sm">
                    <p className="text-body-md font-semibold text-on-surface truncate">{u.groupName}</p>
                    <p className="text-caption text-on-surface-variant">
                      {u.queryAt} · {u.summary}
                    </p>
                    <p className="text-caption text-error">{u.status}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
