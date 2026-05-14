import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess, leadPulseRoleLabel } from "@/lib/lead-pulse-rbac";
import { prisma } from "@/lib/prisma";
import {
  getFunnelTotals,
  getDailyLeadVolumeWithPrior,
  getTodaysEntryStatus,
  getPriorityAlerts,
  getAvgMonthlyTotals,
  getSourceLeadCount,
  getMonthlyConversionBySource,
  getL2WeeklyYouTubeConversion,
  getL2SourceLabels,
  monthBounds,
} from "@/lib/lead-pulse-metrics";
import { todayIst } from "@/lib/lead-pulse-dates";
import { LeadVolumeChart, GroupedConversionBySourceChart } from "./_charts";

export const dynamic = "force-dynamic";

export default async function LeadPulseHomePage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);

  if (access.role === "l1" || access.role === "l2") {
    redirect("/marketing/lead-pulse/daily-entry");
  }
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
          <h1 className="text-[20px] font-semibold mb-[8px]">Lead Pulse access required</h1>
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            You don&apos;t have a Lead Pulse role assigned yet. Contact your supervisor to get
            added to the team roster.
          </p>
        </div>
      </div>
    );
  }

  const today = todayIst();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const dayOfMonth = Number(today.slice(8, 10));
  const { start: monthStart, end: monthEnd } = monthBounds(year, month);
  // Previous month for trend deltas + the like-for-like pace window
  // (1st of prev month through the same day-of-month as today, clamped
  // to the previous month's last day for e.g. May 31 vs April 30).
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prev = monthBounds(prevYear, prevMonth);
  const prevMonthDays = new Date(year, month - 1, 0).getDate();
  const paceEndDay = Math.min(dayOfMonth, prevMonthDays);
  const paceLastMonthEnd = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(paceEndDay).padStart(2, "0")}`;
  const paceLabel = `${shortMonth(prevMonth)} 1–${paceEndDay}`;

  // Find the "last working day" — the most recent calendar day before
  // today that is neither a Sunday nor a stored Holiday. We pull the
  // last 30 days of Holiday rows once so the walk-back is in-memory.
  const lookbackStart = new Date(`${today}T00:00:00.000Z`);
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 30);
  const recentHolidays = await prisma.holiday.findMany({
    where: { date: { gte: lookbackStart } },
    select: { date: true },
  });
  const holidaySet = new Set(recentHolidays.map((h) => h.date.toISOString().slice(0, 10)));
  function findLastWorkingDay(fromStr: string): string {
    const d = new Date(`${fromStr}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    for (let i = 0; i < 31; i++) {
      const ds = d.toISOString().slice(0, 10);
      if (d.getUTCDay() !== 0 && !holidaySet.has(ds)) return ds;
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return fromStr; // fallback — shouldn't happen
  }
  const lastWorkingDay = findLastWorkingDay(today);

  const [
    thisMonth,
    lastMonth,
    paced,
    avg3,
    daily,
    sourceLeadCountLastMtd,
    sourceLeadCount,
    convCompare,
    youtubeWeekly,
    sourceLabels,
    todays,
    alerts,
    activeRoles,
    l1Count,
    l2Count,
  ] = await Promise.all([
    getFunnelTotals({ start: monthStart, end: monthEnd }),
    getFunnelTotals({ start: prev.start, end: prev.end }),
    getFunnelTotals({ start: prev.start, end: paceLastMonthEnd }),
    getAvgMonthlyTotals(year, month, 3),
    getDailyLeadVolumeWithPrior(30),
    getSourceLeadCount({ start: prev.start, end: paceLastMonthEnd }),
    getSourceLeadCount({ start: monthStart, end: monthEnd }),
    getMonthlyConversionBySource(year, month),
    getL2WeeklyYouTubeConversion(),
    getL2SourceLabels(year, month),
    getTodaysEntryStatus({ date: lastWorkingDay, activeOnly: true }),
    getPriorityAlerts(),
    prisma.leadPulseRole.count({ where: { active: true, role: { in: ["l1", "l2"] } } }),
    prisma.leadPulseRole.count({ where: { active: true, role: "l1" } }),
    prisma.leadPulseRole.count({ where: { active: true, role: "l2" } }),
  ]);
  void convCompare;

  const totalLeadsThisMonth = thisMonth.l1Leads + thisMonth.l2Leads;
  const totalLeadsLastMonth = lastMonth.l1Leads + lastMonth.l2Leads;
  const paceLeadsLastMonth = paced.l1Leads + paced.l2Leads;
  const leadsTrend = pctChange(totalLeadsThisMonth, totalLeadsLastMonth);
  const paceTrend = pctChange(totalLeadsThisMonth, paceLeadsLastMonth);
  const wonTrend = pctChange(thisMonth.l2Won, lastMonth.l2Won);
  const submittedToday = todays.filter((t) => t.status === "submitted").length;

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">Lead Pulse Dashboard</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {access.desfinAdmin && access.role !== "supervisor"
              ? "Admin view — full Lead Pulse access."
              : `Welcome${access.displayName ? `, ${access.displayName}` : ""} · ${leadPulseRoleLabel(access.role)}.`}
          </p>
        </div>
        <QuickActions />
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-[16px]">
        <TripletKpi
          label="L1 Total Leads"
          icon="alt_route"
          thisMonth={thisMonth.l1Leads}
          lastMonth={paced.l1Leads}
          lastMonthLabel={`Last MTD (${paceLabel})`}
          avg={avg3.avgL1Leads}
          avgLabel={`Avg ${avg3.months}-mo`}
        />
        <TripletKpi
          label="L2 Total Leads"
          icon="handshake"
          thisMonth={thisMonth.l2Leads}
          lastMonth={paced.l2Leads}
          lastMonthLabel={`Last MTD (${paceLabel})`}
          avg={avg3.avgL2Leads}
          avgLabel={`Avg ${avg3.months}-mo`}
        />
        <Kpi
          label="L1 → L2 %"
          value={thisMonth.l1ConversionPct == null ? "—" : `${thisMonth.l1ConversionPct.toFixed(1)}%`}
          trend={pctChange(thisMonth.l1ConversionPct ?? 0, paced.l1ConversionPct ?? 0)}
          icon="trending_up"
          subLabel={`Last MTD (${paceLabel})`}
          subValue={paced.l1ConversionPct == null ? "—" : `${paced.l1ConversionPct.toFixed(1)}%`}
          target="Target: 60%"
        />
        <Kpi
          label="Closed-Won"
          value={thisMonth.l2Won.toString()}
          trend={pctChange(thisMonth.l2Won, paced.l2Won)}
          icon="emoji_events"
          subLabel={`Last MTD (${paceLabel})`}
          subValue={paced.l2Won.toString()}
        />
        <Kpi
          label="Team Strength"
          value={`L1: ${l1Count} · L2: ${l2Count}`}
          icon="groups"
          subLabel={"Submitted today"}
          subValue={`${submittedToday}/${activeRoles}`}
        />
      </div>
      {/* keep the pace numbers reachable for future tiles */}
      <p className="text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        Same-window pace: {paceLabel} · {paceLeadsLastMonth.toLocaleString("en-IN")}
        {" leads vs "}
        {totalLeadsThisMonth.toLocaleString("en-IN")} this period
        {paceTrend != null
          ? ` (${paceTrend >= 0 ? "▲" : "▼"} ${Math.abs(paceTrend).toFixed(1)}%)`
          : ""}
        {leadsTrend != null
          ? ` · MoM ${leadsTrend >= 0 ? "▲" : "▼"} ${Math.abs(leadsTrend).toFixed(1)}%`
          : ""}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px]">
        <Card title="Lead Volume — last 30 days vs prior 30 days" wide>
          <LeadVolumeChart data={daily} />
          <div
            className="flex items-center gap-[16px] mt-[6px] text-[11px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <span className="inline-flex items-center gap-[4px]">
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: "var(--lp-primary)",
                  borderRadius: 2,
                  display: "inline-block",
                }}
              />
              This 30d
            </span>
            <span className="inline-flex items-center gap-[4px]">
              <span
                style={{
                  width: 10,
                  height: 2,
                  background: "var(--lp-cyan)",
                  display: "inline-block",
                }}
              />
              Prior 30d (offset-aligned by day position)
            </span>
            <span style={{ opacity: 0.7 }}>
              · X-axis = this-window date; hover for the matching prior-window date.
            </span>
          </div>
        </Card>
        <Card title="Conversion by Source — Current Month vs Last Month vs Last 3-months avg">
          <GroupedConversionBySourceChart data={convCompare} />
          <div
            className="flex items-center gap-[16px] mt-[6px] text-[11px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <Legend color="var(--lp-primary)" label="This month" />
            <Legend color="var(--lp-cyan)" label="Last month" />
            <Legend color="var(--lp-orange)" label="3-mo avg" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px]">
        <Card title="Source-wise Lead Count">
          <p className="text-[11px] mb-[8px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            Formula: L1 leads received + L2 direct leads (excludes L2 receivedFromL1
            to avoid double-counting). Last MTD = last month, 1st to {paceLabel}.
          </p>
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                <Th>Source</Th>
                <Th align="right">This month</Th>
                <Th align="right">Last MTD</Th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const lastByCode = new Map(
                  sourceLeadCountLastMtd.map((s) => [s.sourceCode, s.leads]),
                );
                return sourceLeadCount.map((s) => {
                  const last = lastByCode.get(s.sourceCode) ?? 0;
                  return (
                    <tr
                      key={s.sourceCode}
                      className="border-t"
                      style={{ borderColor: "var(--lp-outline-variant)" }}
                    >
                      <td className="px-[16px] py-[6px]">{s.sourceLabel}</td>
                      <td className="px-[16px] py-[6px] text-right">{s.leads}</td>
                      <td
                        className="px-[16px] py-[6px] text-right"
                        style={{ color: "var(--lp-on-surface-variant)" }}
                      >
                        {last}
                      </td>
                    </tr>
                  );
                });
              })()}
              <tr
                className="border-t"
                style={{
                  borderColor: "var(--lp-outline-variant)",
                  backgroundColor: "var(--lp-surface-container-low)",
                }}
              >
                <td
                  className="px-[16px] py-[6px] font-semibold uppercase text-[11px]"
                  style={{ color: "var(--lp-on-surface-variant)" }}
                >
                  Total
                </td>
                <td
                  className="px-[16px] py-[6px] text-right font-semibold"
                  style={{ color: "var(--lp-primary)" }}
                >
                  {sourceLeadCount.reduce((a, b) => a + b.leads, 0)}
                </td>
                <td
                  className="px-[16px] py-[6px] text-right font-semibold"
                  style={{ color: "var(--lp-on-surface-variant)" }}
                >
                  {sourceLeadCountLastMtd.reduce((a, b) => a + b.leads, 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card title="L2 YouTube — last 2 weeks">
          {youtubeWeekly.length === 0 ? (
            <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              No active L2 BDEs.
            </p>
          ) : (
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                  <Th>BDE</Th>
                  <Th align="right">Last wk</Th>
                  <Th align="right">This wk</Th>
                  <Th align="right">Δ</Th>
                </tr>
              </thead>
              <tbody>
                {youtubeWeekly
                  .filter((b) => b.thisWeek > 0 || b.lastWeek > 0)
                  .map((b) => {
                    const delta = b.thisWeek - b.lastWeek;
                    return (
                      <tr key={b.userId} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
                        <td className="px-[16px] py-[6px] font-semibold">{b.displayName}</td>
                        <td className="px-[16px] py-[6px] text-right">{b.lastWeek}</td>
                        <td className="px-[16px] py-[6px] text-right">{b.thisWeek}</td>
                        <td
                          className="px-[16px] py-[6px] text-right font-semibold"
                          style={{ color: delta >= 0 ? "var(--lp-cyan)" : "var(--lp-error)" }}
                        >
                          {delta >= 0 ? "+" : ""}
                          {delta}
                        </td>
                      </tr>
                    );
                  })}
                {youtubeWeekly.every((b) => b.thisWeek === 0 && b.lastWeek === 0) && (
                  <tr>
                    <td colSpan={4} className="px-[16px] py-[16px] text-center" style={{ color: "var(--lp-on-surface-variant)" }}>
                      No YouTube closes either week.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="L2 Source Champions (this month)">
          {sourceLabels.length === 0 ? (
            <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              No active L2 BDEs.
            </p>
          ) : (
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                  <Th>BDE</Th>
                  <Th>Crown</Th>
                  <Th align="right">Top</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {[...sourceLabels]
                  .sort((a, b) => b.totalClosedWon - a.totalClosedWon)
                  .map((b) => (
                    <tr key={b.userId} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
                      <td className="px-[16px] py-[6px] font-semibold">{b.displayName}</td>
                      <td className="px-[16px] py-[6px]">
                        {b.topSourceLabel ? (
                          <span
                            className="px-[8px] py-[2px] rounded-full text-[11px] font-semibold"
                            style={{
                              backgroundColor: "rgba(250,204,21,0.18)",
                              color: "var(--lp-primary)",
                            }}
                          >
                            {b.topSourceLabel} Queen
                          </span>
                        ) : (
                          <span style={{ color: "var(--lp-on-surface-variant)" }}>—</span>
                        )}
                      </td>
                      <td className="px-[16px] py-[6px] text-right">{b.topSourceCount}</td>
                      <td className="px-[16px] py-[6px] text-right font-semibold" style={{ color: "var(--lp-primary)" }}>
                        {b.totalClosedWon}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px]">
        <div className="lg:col-span-2">
          <Card title={`Last Working Day's Entries (${lastWorkingDay})`}>
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                  <Th>BDE</Th>
                  <Th>Role</Th>
                  <Th align="right">Leads Logged</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {todays.map((t) => (
                  <tr key={t.userId} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
                    <td className="px-[16px] py-[8px] font-semibold">{t.displayName}</td>
                    <td className="px-[16px] py-[8px] uppercase text-[11px]" style={{ color: roleColor(t.role) }}>
                      {t.role}
                    </td>
                    <td className="px-[16px] py-[8px] text-right tabular-nums">{t.leadsLogged}</td>
                    <td className="px-[16px] py-[8px]">
                      <StatusPill status={t.status} />
                    </td>
                  </tr>
                ))}
                {todays.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-[16px] py-[16px] text-center" style={{ color: "var(--lp-on-surface-variant)" }}>
                      No active BDEs rostered yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        <Card title="Priority Alerts">
          {alerts.length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              All clear — no alerts to flag.
            </p>
          ) : (
            <ul className="space-y-[10px]">
              {alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-[8px] text-[13px]">
                  <span className="material-symbols-outlined mt-[2px]" style={{ fontSize: 16, color: alertColor(a.kind) }}>
                    {alertIcon(a.kind)}
                  </span>
                  <span className="flex-1" style={{ color: "var(--lp-on-surface)" }}>
                    {a.message}{" "}
                    {a.href && (
                      <Link href={a.href} className="underline" style={{ color: "var(--lp-primary)" }}>
                        View
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function pctChange(now: number, prev: number): number | null {
  if (prev === 0) return now === 0 ? 0 : null;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

function Kpi({
  label,
  value,
  trend,
  icon,
  paceLabel,
  paceValue,
  paceTrend,
  subLabel,
  subValue,
  target,
}: {
  label: string;
  value: string;
  trend?: number | null;
  icon: string;
  paceLabel?: string;
  paceValue?: number;
  paceTrend?: number | null;
  subLabel?: string;
  subValue?: string;
  target?: string;
}) {
  return (
    <div
      className="rounded-[12px] p-[16px] border flex items-start justify-between"
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      <div className="min-w-0">
        <span
          className="inline-flex items-center justify-center w-[32px] h-[32px] rounded-[8px] mb-[8px]"
          style={{ backgroundColor: "var(--lp-surface-container-high)", color: "var(--lp-primary)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{icon}</span>
        </span>
        <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
          {label}
        </p>
        <p className="text-[26px] font-bold tabular-nums mt-[2px]" style={{ color: "var(--lp-primary)" }}>
          {value}
        </p>
        {target && (
          <p className="text-[11px] mt-[2px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {target}
          </p>
        )}
        {subLabel && subValue != null && (
          <p
            className="text-[11px] mt-[6px] flex flex-wrap items-baseline gap-[6px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <span style={{ opacity: 0.8 }}>{subLabel}:</span>
            <span className="tabular-nums" style={{ color: "var(--lp-on-surface)" }}>
              {subValue}
            </span>
          </p>
        )}
        {paceLabel && paceValue != null && (
          <p
            className="text-[11px] mt-[6px] flex items-center gap-[6px] flex-wrap"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <span>
              Pace: <span className="tabular-nums">{paceValue.toLocaleString("en-IN")}</span>{" "}
              <span style={{ opacity: 0.8 }}>({paceLabel})</span>
            </span>
            {paceTrend != null ? (
              <span
                className="text-[10px] px-[6px] py-[1px] rounded-full"
                style={{
                  backgroundColor:
                    paceTrend >= 0 ? "rgba(51, 228, 255, 0.18)" : "rgba(255, 180, 171, 0.18)",
                  color: paceTrend >= 0 ? "var(--lp-cyan)" : "var(--lp-error)",
                }}
                title="Same-window pace vs last month"
              >
                {paceTrend >= 0 ? "▲" : "▼"} {Math.abs(paceTrend).toFixed(1)}%
              </span>
            ) : (
              <span className="text-[10px]" style={{ opacity: 0.6 }} title="No data last month for this window">
                —
              </span>
            )}
          </p>
        )}
      </div>
      {trend != null && (
        <span
          className="text-[11px] px-[8px] py-[2px] rounded-full whitespace-nowrap"
          style={{
            backgroundColor: trend >= 0 ? "rgba(51, 228, 255, 0.18)" : "rgba(255, 180, 171, 0.18)",
            color: trend >= 0 ? "var(--lp-cyan)" : "var(--lp-error)",
          }}
        >
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

/**
 * KPI tile that stacks three numbers: this month, last month, and an
 * average. Used for the L1 / L2 Total Leads tiles on the dashboard.
 */
function TripletKpi({
  label,
  icon,
  thisMonth,
  lastMonth,
  lastMonthLabel = "Last month",
  avg,
  avgLabel,
}: {
  label: string;
  icon: string;
  thisMonth: number;
  lastMonth: number;
  lastMonthLabel?: string;
  avg: number;
  avgLabel: string;
}) {
  const monthTrend = lastMonth === 0 ? null : ((thisMonth - lastMonth) / lastMonth) * 100;
  const avgTrend = avg === 0 ? null : ((thisMonth - avg) / avg) * 100;
  return (
    <div
      className="rounded-[12px] p-[16px] border"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      <div className="flex items-center gap-[8px] mb-[8px]">
        <span
          className="inline-flex items-center justify-center w-[28px] h-[28px] rounded-[6px]"
          style={{
            backgroundColor: "var(--lp-surface-container-high)",
            color: "var(--lp-primary)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {icon}
          </span>
        </span>
        <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
          {label}
        </p>
      </div>
      <p className="text-[26px] font-bold tabular-nums" style={{ color: "var(--lp-primary)" }}>
        {thisMonth.toLocaleString("en-IN")}
      </p>
      <div className="grid grid-cols-2 gap-[6px] mt-[8px] text-[11px]">
        <div>
          <p style={{ color: "var(--lp-on-surface-variant)" }}>{lastMonthLabel}</p>
          <p className="font-mono">{lastMonth.toLocaleString("en-IN")}</p>
          {monthTrend != null && (
            <span
              className="text-[10px]"
              style={{ color: monthTrend >= 0 ? "var(--lp-cyan)" : "var(--lp-error)" }}
            >
              {monthTrend >= 0 ? "▲" : "▼"} {Math.abs(monthTrend).toFixed(1)}%
            </span>
          )}
        </div>
        <div>
          <p style={{ color: "var(--lp-on-surface-variant)" }}>{avgLabel}</p>
          <p className="font-mono">{avg.toLocaleString("en-IN")}</p>
          {avgTrend != null && (
            <span
              className="text-[10px]"
              style={{ color: avgTrend >= 0 ? "var(--lp-cyan)" : "var(--lp-error)" }}
            >
              {avgTrend >= 0 ? "▲" : "▼"} {Math.abs(avgTrend).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-[4px]">
      <span
        style={{
          width: 10,
          height: 10,
          backgroundColor: color,
          borderRadius: 2,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

function shortMonth(month: number): string {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    month - 1
  ]!;
}

function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className={"rounded-[12px] border p-[20px] " + (wide ? "lg:col-span-2" : "")}
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      <h2 className="text-[14px] font-semibold mb-[12px]">{title}</h2>
      {children}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className="px-[16px] py-[10px] text-[11px] font-semibold uppercase tracking-[0.05em]"
      style={{ textAlign: align ?? "left", color: "var(--lp-on-surface-variant)" }}
    >
      {children}
    </th>
  );
}

function StatusPill({ status }: { status: "submitted" | "draft" | "missing" }) {
  const map = {
    submitted: { label: "Submitted", bg: "rgba(51, 228, 255, 0.18)", color: "var(--lp-cyan)" },
    draft: { label: "Draft", bg: "rgba(255, 182, 147, 0.18)", color: "var(--lp-orange)" },
    missing: { label: "—", bg: "rgba(154, 144, 120, 0.18)", color: "var(--lp-on-surface-variant)" },
  } as const;
  const { label, bg, color } = map[status];
  return (
    <span
      className="text-[11px] px-[8px] py-[2px] rounded-full font-semibold"
      style={{ backgroundColor: bg, color }}
    >
      {label}
    </span>
  );
}

function roleColor(role: string) {
  if (role === "l1") return "var(--lp-primary)";
  if (role === "l2") return "var(--lp-cyan)";
  return "var(--lp-orange)";
}

function alertIcon(kind: string): string {
  if (kind === "performance_dip") return "trending_down";
  if (kind === "target_achieved") return "verified";
  if (kind === "pending_drafts") return "edit_note";
  if (kind === "inactive_bde") return "person_off";
  return "info";
}
function alertColor(kind: string): string {
  if (kind === "performance_dip") return "var(--lp-error)";
  if (kind === "target_achieved") return "var(--lp-cyan)";
  if (kind === "pending_drafts") return "var(--lp-orange)";
  if (kind === "inactive_bde") return "var(--lp-orange)";
  return "var(--lp-on-surface-variant)";
}

function QuickActions() {
  return (
    <div className="flex items-center gap-[8px]">
      <Link
        href="/marketing/lead-pulse/monthly-report"
        className="h-[40px] px-[16px] rounded-[8px] text-[13px] font-semibold inline-flex items-center"
        style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
      >
        Run monthly report
      </Link>
      <Link
        href="/marketing/lead-pulse/targets"
        className="h-[40px] px-[16px] rounded-[8px] text-[13px] font-semibold inline-flex items-center border"
        style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
      >
        L2 targets
      </Link>
      <Link
        href="/marketing/lead-pulse/team-roster"
        className="h-[40px] px-[16px] rounded-[8px] text-[13px] font-semibold inline-flex items-center border"
        style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
      >
        Team roster
      </Link>
    </div>
  );
}
