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
  getSourceLeadCountAvgMonthly,
  getMonthlyConversionBySource,
  getSourceDisqualifiedAnalysis,
  getL2WeeklyYouTubeConversion,
  getL2WeeklyMetaConversion,
  getL2SourceLabels,
  getServiceConversionMatrix,
  monthBounds,
} from "@/lib/lead-pulse-metrics";
import { todayIst } from "@/lib/lead-pulse-dates";
import {
  LeadVolumeChart,
  GroupedConversionBySourceChart,
  DisqualifiedMonthlyChart,
  DisqualifiedDailyChart,
} from "./_charts";
import { Kpi, TripletKpi, pctChange } from "./_kpi";
import { TargetAchievementCard } from "./_target-achievement";

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
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
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
    sourceLeadCountAvg3Mo,
    convCompare,
    youtubeWeekly,
    metaWeekly,
    sourceLabels,
    todays,
    alerts,
    activeRoles,
    l1Count,
    l2Count,
    metaDisqAnalysis,
    serviceMatrix,
  ] = await Promise.all([
    getFunnelTotals({ start: monthStart, end: monthEnd }),
    getFunnelTotals({ start: prev.start, end: prev.end }),
    getFunnelTotals({ start: prev.start, end: paceLastMonthEnd }),
    getAvgMonthlyTotals(year, month, 3),
    getDailyLeadVolumeWithPrior(30),
    getSourceLeadCount({ start: prev.start, end: paceLastMonthEnd }),
    getSourceLeadCount({ start: monthStart, end: monthEnd }),
    // Historical importer lumped each month's totals into a single day.
    // Drop those days from rolling-average sums so the 3-mo line is meaningful.
    getSourceLeadCountAvgMonthly(year, month, 3, ["2026-02-28", "2026-03-27"]),
    getMonthlyConversionBySource(year, month),
    getL2WeeklyYouTubeConversion(),
    getL2WeeklyMetaConversion(),
    getL2SourceLabels(year, month),
    getTodaysEntryStatus({ date: lastWorkingDay, activeOnly: true }),
    getPriorityAlerts(),
    prisma.leadPulseRole.count({ where: { active: true, role: { in: ["l1", "l2"] } } }),
    prisma.leadPulseRole.count({ where: { active: true, role: "l1" } }),
    prisma.leadPulseRole.count({ where: { active: true, role: "l2" } }),
    getSourceDisqualifiedAnalysis("meta", year, month, 6),
    getServiceConversionMatrix(year, month),
  ]);
  void convCompare;

  // Auto-insight for the 30-day vs prior-30-day chart. Deterministic
  // narrative built from the same `daily` series the chart reads —
  // total deltas, best/worst days, % change. Surfaced under the chart.
  const leadVolumeInsight = (() => {
    const fmt = (n: number) => n.toLocaleString("en-IN");
    const totalThis = daily.reduce((a, r) => a + (r.leads ?? 0), 0);
    const totalPrior = daily.reduce((a, r) => a + (r.priorLeads ?? 0), 0);
    const delta =
      totalPrior > 0
        ? Math.round(((totalThis - totalPrior) / totalPrior) * 1000) / 10
        : null;
    const arrow = delta == null ? "" : delta > 0 ? "▲" : delta < 0 ? "▼" : "━";
    const direction =
      delta == null ? "is unchanged" : delta > 0 ? "is up" : delta < 0 ? "is down" : "is flat";
    const pctText = delta == null ? "n/a" : `${arrow} ${Math.abs(delta).toFixed(1)}%`;

    // Peak / quiet days in current window (skipping any explicit zero
    // for the "quiet" pick so a not-yet-submitted future day doesn't win).
    const sorted = [...daily].sort((a, b) => (b.leads ?? 0) - (a.leads ?? 0));
    const peak = sorted[0];
    const nonZero = daily.filter((r) => (r.leads ?? 0) > 0).sort((a, b) => (a.leads ?? 0) - (b.leads ?? 0));
    const quiet = nonZero[0];

    // Day-of-week peak/quiet — gives a "Mondays are strongest" angle.
    const dowBuckets = new Map<number, { leads: number; count: number }>();
    for (const r of daily) {
      if ((r.leads ?? 0) === 0) continue;
      const dow = new Date(`${r.date}T00:00:00.000Z`).getUTCDay();
      const cur = dowBuckets.get(dow) ?? { leads: 0, count: 0 };
      cur.leads += r.leads ?? 0;
      cur.count += 1;
      dowBuckets.set(dow, cur);
    }
    const dowAvg = Array.from(dowBuckets.entries())
      .map(([dow, v]) => ({ dow, avg: v.leads / v.count }))
      .sort((a, b) => b.avg - a.avg);
    const dowLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const bestDow = dowAvg[0];

    const sentences: string[] = [];
    sentences.push(
      delta == null
        ? `Last 30 days: ${fmt(totalThis)} leads (no comparable prior-window data).`
        : `Last 30 days: ${fmt(totalThis)} leads — ${direction} ${pctText} vs the prior 30 days (${fmt(totalPrior)}).`,
    );
    if (peak && (peak.leads ?? 0) > 0) {
      sentences.push(`Peak day: ${peak.date} with ${fmt(peak.leads ?? 0)} leads.`);
    }
    if (quiet && (quiet.leads ?? 0) > 0 && quiet.date !== peak?.date) {
      sentences.push(`Quietest active day: ${quiet.date} (${fmt(quiet.leads ?? 0)} leads).`);
    }
    if (bestDow && bestDow.avg > 0) {
      sentences.push(
        `${dowLabels[bestDow.dow]}s are the strongest day-of-week, averaging ${Math.round(bestDow.avg)} leads.`,
      );
    }
    return {
      tone: delta == null ? "info" : delta > 0 ? "up" : delta < 0 ? "down" : "info",
      sentences,
    } as { tone: "up" | "down" | "info"; sentences: string[] };
  })();

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
          <div
            className="mt-[12px] rounded-[10px] border p-[12px] flex gap-[10px] items-start"
            style={{
              backgroundColor: "var(--lp-surface-container-low)",
              borderColor:
                leadVolumeInsight.tone === "up"
                  ? "rgba(51, 228, 255, 0.45)"
                  : leadVolumeInsight.tone === "down"
                    ? "rgba(255, 180, 171, 0.45)"
                    : "var(--lp-outline-variant)",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 18,
                color:
                  leadVolumeInsight.tone === "up"
                    ? "var(--lp-cyan)"
                    : leadVolumeInsight.tone === "down"
                      ? "var(--lp-error)"
                      : "var(--lp-primary)",
              }}
              aria-hidden
            >
              auto_awesome
            </span>
            <div className="flex-1 min-w-0">
              <p
                className="text-[10px] uppercase tracking-widest font-semibold mb-[4px]"
                style={{ color: "var(--lp-primary)" }}
              >
                AI Insight
              </p>
              <ul className="space-y-[3px] text-[12px]" style={{ color: "var(--lp-on-surface)" }}>
                {leadVolumeInsight.sentences.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
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
            3-mo avg excludes the 28 Feb &amp; 27 Mar 2026 lump-import days.
          </p>
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                <Th>Source</Th>
                <Th align="right">This month</Th>
                <Th align="right">Last MTD</Th>
                <Th align="right">Avg 3-mo</Th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const lastByCode = new Map(
                  sourceLeadCountLastMtd.map((s) => [s.sourceCode, s.leads]),
                );
                const avgByCode = new Map(
                  sourceLeadCountAvg3Mo.map((s) => [s.sourceCode, s.avg]),
                );
                return sourceLeadCount.map((s) => {
                  const last = lastByCode.get(s.sourceCode) ?? 0;
                  const avg = avgByCode.get(s.sourceCode) ?? 0;
                  return (
                    <tr
                      key={s.sourceCode}
                      className="border-t"
                      style={{ borderColor: "var(--lp-outline-variant)" }}
                    >
                      <td className="px-[16px] py-[6px]">{s.sourceLabel}</td>
                      <td className="px-[16px] py-[6px] text-right">
                        <span className="inline-flex items-center justify-end gap-[6px]">
                          <span>{s.leads}</span>
                          <TrendPill now={s.leads} prev={last} />
                        </span>
                      </td>
                      <td
                        className="px-[16px] py-[6px] text-right"
                        style={{ color: "var(--lp-on-surface-variant)" }}
                      >
                        {last}
                      </td>
                      <td
                        className="px-[16px] py-[6px] text-right"
                        style={{ color: "var(--lp-on-surface-variant)" }}
                      >
                        {avg}
                      </td>
                    </tr>
                  );
                });
              })()}
              {(() => {
                const thisTotal = sourceLeadCount.reduce((a, b) => a + b.leads, 0);
                const lastTotal = sourceLeadCountLastMtd.reduce((a, b) => a + b.leads, 0);
                const avgTotal = Math.round(sourceLeadCountAvg3Mo.reduce((a, b) => a + b.avg, 0) * 10) / 10;
                return (
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
                      <span className="inline-flex items-center justify-end gap-[6px]">
                        <span>{thisTotal}</span>
                        <TrendPill now={thisTotal} prev={lastTotal} />
                      </span>
                    </td>
                    <td
                      className="px-[16px] py-[6px] text-right font-semibold"
                      style={{ color: "var(--lp-on-surface-variant)" }}
                    >
                      {lastTotal}
                    </td>
                    <td
                      className="px-[16px] py-[6px] text-right font-semibold"
                      style={{ color: "var(--lp-on-surface-variant)" }}
                    >
                      {avgTotal}
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </Card>

        <Card title={`${metaDisqAnalysis.sourceLabel} Disqualified — analysis`}>
          <div
            className="flex flex-wrap items-baseline gap-[12px] mb-[8px]"
            style={{ color: "var(--lp-on-surface)" }}
          >
            <span className="text-[22px] font-bold tabular-nums" style={{ color: "var(--lp-orange)" }}>
              {metaDisqAnalysis.summary.last30d}
            </span>
            <span className="text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              last 30 days vs <span className="tabular-nums">{metaDisqAnalysis.summary.prior30d}</span>{" "}
              prior 30 days
            </span>
            {metaDisqAnalysis.summary.deltaPct != null && (
              <span
                className="text-[10px] px-[6px] py-[1px] rounded-full"
                style={{
                  backgroundColor:
                    metaDisqAnalysis.summary.deltaPct <= 0
                      ? "rgba(51, 228, 255, 0.18)"
                      : "rgba(255, 180, 171, 0.18)",
                  color:
                    metaDisqAnalysis.summary.deltaPct <= 0
                      ? "var(--lp-cyan)"
                      : "var(--lp-error)",
                }}
                title="Lower disqualified count is better; flips colours accordingly."
              >
                {metaDisqAnalysis.summary.deltaPct >= 0 ? "▲" : "▼"}{" "}
                {Math.abs(metaDisqAnalysis.summary.deltaPct).toFixed(1)}%
              </span>
            )}
          </div>
          <p
            className="text-[11px] mt-[4px] mb-[2px] uppercase tracking-widest"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            Monthly trend (last 6 months)
          </p>
          <DisqualifiedMonthlyChart data={metaDisqAnalysis.monthly} />
          <div
            className="flex items-center gap-[16px] mt-[2px] text-[11px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <Legend color="var(--lp-orange)" label="Disqualified count" />
            <Legend color="var(--lp-primary)" label="Disqualified % (of total Meta leads)" />
          </div>
          <p
            className="text-[11px] mt-[10px] mb-[2px] uppercase tracking-widest"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            Daily — last 30 days vs prior 30 days
          </p>
          <DisqualifiedDailyChart data={metaDisqAnalysis.daily} />
          <div
            className="flex items-center gap-[16px] mt-[6px] text-[11px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <Legend color="var(--lp-orange)" label="This 30d" />
            <Legend color="var(--lp-cyan)" label="Prior 30d" />
          </div>
        </Card>

        <L2WeeklySourceCard
          title="L2 YouTube — last 2 weeks"
          sourceLabel="YouTube"
          weekly={youtubeWeekly}
        />
        <L2WeeklySourceCard
          title="L2 Meta — last 2 weeks"
          sourceLabel="Meta"
          weekly={metaWeekly}
        />

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


      {/* Monthly target achievement — shared component, mirrors Monthly Report. */}
      <TargetAchievementCard matrix={serviceMatrix} monthLabel={monthLabel} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px]">
        <div className="lg:col-span-2">
          <Card title={`Recent Submissions (anchor: ${lastWorkingDay})`}>
            <p
              className="text-[11px] mb-[8px]"
              style={{ color: "var(--lp-on-surface-variant)" }}
            >
              Each row shows the BDE&apos;s most recent submitted (or draft) entry within the last 5 days.
              A BDE who logged for the wrong date still surfaces here so off-by-one submissions don&apos;t hide.
            </p>
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                  <Th>BDE</Th>
                  <Th>Role</Th>
                  <Th>Latest Entry</Th>
                  <Th align="right">Leads Logged</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {todays.map((t) => {
                  const dateLabel = t.latestDate ?? "—";
                  const mismatched = t.latestDate && t.latestDate !== lastWorkingDay;
                  return (
                    <tr
                      key={t.userId}
                      className="border-t"
                      style={{ borderColor: "var(--lp-outline-variant)" }}
                    >
                      <td className="px-[16px] py-[8px] font-semibold">{t.displayName}</td>
                      <td
                        className="px-[16px] py-[8px] uppercase text-[11px]"
                        style={{ color: roleColor(t.role) }}
                      >
                        {t.role}
                      </td>
                      <td className="px-[16px] py-[8px] tabular-nums">
                        <span
                          style={{ color: mismatched ? "var(--lp-orange)" : "var(--lp-on-surface)" }}
                          title={
                            mismatched
                              ? `Submitted for ${t.latestDate} instead of ${lastWorkingDay}`
                              : undefined
                          }
                        >
                          {dateLabel}
                        </span>
                      </td>
                      <td className="px-[16px] py-[8px] text-right tabular-nums">{t.leadsLogged}</td>
                      <td className="px-[16px] py-[8px]">
                        <div className="flex flex-wrap items-center gap-[6px]">
                          <StatusPill status={t.status} />
                          <ApprovalPill status={t.approvalStatus} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {todays.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-[16px] py-[16px] text-center" style={{ color: "var(--lp-on-surface-variant)" }}>
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

/**
 * Tiny ▲X.X% / ▼X.X% pill comparing `now` vs `prev`. Renders nothing
 * when prev is 0 (no baseline → no comparison) and a muted "—" when
 * both sides are zero.
 */
function TrendPill({ now, prev }: { now: number; prev: number }) {
  const delta = pctChange(now, prev);
  if (delta == null) {
    return (
      <span className="text-[10px]" style={{ opacity: 0.5 }} title="No baseline last month">
        new
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="text-[10px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        ━ 0%
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className="text-[10px] px-[6px] py-[1px] rounded-full"
      style={{
        backgroundColor: up ? "rgba(51, 228, 255, 0.18)" : "rgba(255, 180, 171, 0.18)",
        color: up ? "var(--lp-cyan)" : "var(--lp-error)",
      }}
      title={`${now} vs ${prev} last MTD`}
    >
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
    </span>
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

/** Shared card body for the per-source weekly allocation views. Used
 *  for "L2 YouTube — last 2 weeks" and "L2 Meta — last 2 weeks", both
 *  fed by getL2WeeklySourceConversion under the hood. */
function L2WeeklySourceCard({
  title,
  sourceLabel,
  weekly,
}: {
  title: string;
  sourceLabel: string;
  weekly: {
    rows: Array<{
      userId: string;
      displayName: string;
      lastWeek: number;
      thisWeek: number;
      active: boolean;
      share: 1 | 2;
    }>;
    allocation: {
      rule: "top-last-week-double";
      leaders: Array<{ userId: string; displayName: string }>;
      order: Array<{ userId: string; displayName: string; share: 1 | 2 }>;
      noWinner: boolean;
    };
  };
}) {
  return (
    <Card title={title}>
      {weekly.rows.length === 0 ? (
        <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          No active L2 BDEs.
        </p>
      ) : (
        <>
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                <Th>BDE</Th>
                <Th align="right">Last wk</Th>
                <Th align="right">This wk</Th>
                <Th align="right">Δ</Th>
                <Th align="right">Next share</Th>
              </tr>
            </thead>
            <tbody>
              {weekly.rows
                .filter((b) => b.thisWeek > 0 || b.lastWeek > 0)
                .map((b) => {
                  const delta = b.thisWeek - b.lastWeek;
                  const isLeader = b.share === 2 && b.active;
                  return (
                    <tr
                      key={b.userId}
                      className="border-t"
                      style={{ borderColor: "var(--lp-outline-variant)" }}
                    >
                      <td className="px-[16px] py-[6px] font-semibold">
                        {b.displayName}
                        {!b.active && (
                          <span
                            className="ml-[6px] text-[10px] uppercase tracking-widest"
                            style={{ color: "var(--lp-on-surface-variant)" }}
                          >
                            inactive
                          </span>
                        )}
                      </td>
                      <td className="px-[16px] py-[6px] text-right">{b.lastWeek}</td>
                      <td className="px-[16px] py-[6px] text-right">{b.thisWeek}</td>
                      <td
                        className="px-[16px] py-[6px] text-right font-semibold"
                        style={{ color: delta >= 0 ? "var(--lp-cyan)" : "var(--lp-error)" }}
                      >
                        {delta >= 0 ? "+" : ""}
                        {delta}
                      </td>
                      <td className="px-[16px] py-[6px] text-right">
                        {!b.active ? (
                          <span style={{ color: "var(--lp-on-surface-variant)", opacity: 0.6 }}>—</span>
                        ) : isLeader ? (
                          <span
                            className="inline-flex items-center gap-[4px] font-semibold"
                            style={{ color: "var(--lp-primary)" }}
                            title="Top performer last week — gets 2 leads per allocation cycle"
                          >
                            <span aria-hidden>👑</span>
                            <span>2 leads</span>
                          </span>
                        ) : (
                          <span style={{ color: "var(--lp-on-surface-variant)" }}>1 lead</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {weekly.rows.every((b) => b.thisWeek === 0 && b.lastWeek === 0) && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-[16px] py-[16px] text-center"
                    style={{ color: "var(--lp-on-surface-variant)" }}
                  >
                    No {sourceLabel} closes either week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div
            className="mt-[12px] rounded-[10px] border p-[12px]"
            style={{
              backgroundColor: "var(--lp-surface-container-low)",
              borderColor: "var(--lp-outline-variant)",
            }}
          >
            <p
              className="text-[10px] uppercase tracking-widest font-semibold mb-[4px]"
              style={{ color: "var(--lp-primary)" }}
            >
              Next allocation cycle
            </p>
            {weekly.allocation.order.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                No active L2 BDEs to allocate to.
              </p>
            ) : weekly.allocation.noWinner ? (
              <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                No closes last week — round-robin with equal shares of 1 lead each:{" "}
                <span style={{ color: "var(--lp-on-surface)" }}>
                  {weekly.allocation.order.map((o) => o.displayName).join(" → ")}
                </span>
                .
              </p>
            ) : (
              <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                Top performer
                {weekly.allocation.leaders.length > 1 ? "s" : ""} last week → 2 leads/cycle.
                Others → 1 lead/cycle. Round-robin order:{" "}
                <span style={{ color: "var(--lp-on-surface)" }}>
                  {weekly.allocation.order
                    .map((o) => (o.share === 2 ? `${o.displayName} ×2` : o.displayName))
                    .join(" → ")}
                </span>
                .
              </p>
            )}
          </div>
        </>
      )}
    </Card>
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

/** Supervisor-side review state shown next to StatusPill. */
function ApprovalPill({
  status,
}: {
  status: "approved" | "rejected" | "pending" | "draft" | "missing";
}) {
  if (status === "missing" || status === "draft") return null;
  const map = {
    pending: {
      label: "Pending for approval",
      bg: "rgba(250, 204, 21, 0.18)",
      color: "var(--lp-primary)",
    },
    approved: {
      label: "Approved",
      bg: "rgba(51, 228, 255, 0.18)",
      color: "var(--lp-cyan)",
    },
    rejected: {
      label: "Rejected",
      bg: "rgba(255, 180, 171, 0.18)",
      color: "var(--lp-error)",
    },
  } as const;
  const { label, bg, color } = map[status as "pending" | "approved" | "rejected"];
  return (
    <span
      className="text-[10px] px-[8px] py-[2px] rounded-full font-semibold whitespace-nowrap"
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
