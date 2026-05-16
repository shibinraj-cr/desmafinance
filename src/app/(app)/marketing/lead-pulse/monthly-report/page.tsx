import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { prisma } from "@/lib/prisma";
import {
  getFunnelTotals,
  getMonthlyMatrix,
  getMonthsWithData,
  getHistoricalFunnel,
  getAvgMonthlyTotals,
  generateInsightNarrative,
  monthBounds,
  type Matrix,
  type MatrixBdeRow,
  type MatrixCell,
} from "@/lib/lead-pulse-metrics";
import { todayIst } from "@/lib/lead-pulse-dates";
import { HistoricalFunnelChart } from "../_charts";
import { Kpi as LpKpi, TripletKpi, pctChange as lpPctChange } from "../_kpi";

export const dynamic = "force-dynamic";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: {
    year?: string;
    month?: string;
    source?: string;
    region?: string;
    startDate?: string;
    endDate?: string;
  };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
        >
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            Only supervisors and admins can run the monthly report.
          </p>
        </div>
      </div>
    );
  }

  const today = todayIst();
  const months = await getMonthsWithData();
  // Default to the current calendar month so the report always opens
  // on "now". Earlier (and any stray-future) months are still pickable
  // from the dropdown — but we don't auto-jump to them.
  const year = searchParams.year
    ? Number(searchParams.year)
    : Number(today.slice(0, 4));
  const month = searchParams.month
    ? Number(searchParams.month)
    : Number(today.slice(5, 7));
  const sourceCode = searchParams.source || null;
  const region = searchParams.region || null;
  const startDate =
    searchParams.startDate && DATE_RX.test(searchParams.startDate) ? searchParams.startDate : null;
  const endDate =
    searchParams.endDate && DATE_RX.test(searchParams.endDate) ? searchParams.endDate : null;

  const [allSources, allRegions] = await Promise.all([
    prisma.leadPulseSource.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
    }),
    prisma.leadPulseRegion.findMany({ where: { active: true }, orderBy: [{ label: "asc" }] }),
  ]);

  const monthRange = monthBounds(year, month);
  // Effective range: caller-supplied date filter overrides the month
  // bounds, clamped within the picked month so e.g. May 1–10 reports
  // can't accidentally pull April data.
  const effStart = startDate
    ? startDate < monthRange.start
      ? monthRange.start
      : startDate
    : monthRange.start;
  const effEnd = endDate
    ? endDate > monthRange.end
      ? monthRange.end
      : endDate
    : monthRange.end;
  // Match the same windowed offset for the prior-month comparison so
  // KPI trends are like-for-like (e.g. May 1–10 vs Apr 1–10).
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prev = monthBounds(prevYear, prevMonth);
  const dayOfMonthStart = Number(effStart.slice(8, 10));
  const dayOfMonthEnd = Number(effEnd.slice(8, 10));
  const prevDays = new Date(prevYear, prevMonth, 0).getDate();
  const prevEffStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(Math.min(dayOfMonthStart, prevDays)).padStart(2, "0")}`;
  const prevEffEnd = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(Math.min(dayOfMonthEnd, prevDays)).padStart(2, "0")}`;
  const hasDateFilter = effStart !== monthRange.start || effEnd !== monthRange.end;

  const sourceId = sourceCode ? allSources.find((s) => s.code === sourceCode)?.id ?? null : null;

  const [matrix, totals, prevTotals, history, avg3] = await Promise.all([
    getMonthlyMatrix({
      year,
      month,
      sourceCode,
      region,
      startDate: effStart,
      endDate: effEnd,
    }),
    getFunnelTotals({ start: effStart, end: effEnd, sourceId }),
    getFunnelTotals({ start: prevEffStart, end: prevEffEnd, sourceId }),
    getHistoricalFunnel({ endYear: year, endMonth: month, monthsBack: 6 }),
    getAvgMonthlyTotals(year, month, 3),
  ]);

  const totalLeads = totals.l1Leads + totals.l2Leads;
  const totalWon = totals.l2Won;
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  const rangeLabel = hasDateFilter ? `${effStart} → ${effEnd}` : monthLabel;
  const insight = generateInsightNarrative(matrix);

  const exportHref =
    `/api/marketing/lead-pulse/monthly-report/export?year=${year}&month=${month}` +
    (sourceCode ? `&source=${sourceCode}` : "") +
    (region ? `&region=${region}` : "") +
    (hasDateFilter ? `&startDate=${effStart}&endDate=${effEnd}` : "");

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">Monthly Funnel Report</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {rangeLabel} · {totalLeads} leads · {totalWon} closed-won
          </p>
        </div>
        <div className="flex items-center gap-[8px]">
          <a
            href={exportHref}
            className="h-[36px] px-[12px] rounded-[8px] text-[13px] font-semibold inline-flex items-center border"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
          >
            <span className="material-symbols-outlined mr-[6px]" style={{ fontSize: 16 }}>
              download
            </span>
            Excel
          </a>
        </div>
      </header>

      <form
        action="/marketing/lead-pulse/monthly-report"
        method="get"
        className="flex flex-wrap items-center gap-[8px] rounded-[12px] p-[12px] border"
        style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
      >
        <Select name="year" defaultValue={String(year)} options={uniqueYears(months, year)} />
        <Select
          name="month"
          defaultValue={String(month)}
          options={[
            ["1", "Jan"], ["2", "Feb"], ["3", "Mar"], ["4", "Apr"], ["5", "May"], ["6", "Jun"],
            ["7", "Jul"], ["8", "Aug"], ["9", "Sep"], ["10", "Oct"], ["11", "Nov"], ["12", "Dec"],
          ]}
        />
        <Select
          name="source"
          defaultValue={sourceCode ?? ""}
          options={[["", "All Sources"] as const, ...allSources.map((s) => [s.code, s.label] as const)]}
        />
        <Select
          name="region"
          defaultValue={region ?? ""}
          options={[["", "All Regions"] as const, ...allRegions.map((r) => [r.code, r.label] as const)]}
        />
        <DateInput
          name="startDate"
          defaultValue={startDate ?? ""}
          min={monthRange.start}
          max={monthRange.end}
          placeholder="From"
        />
        <DateInput
          name="endDate"
          defaultValue={endDate ?? ""}
          min={monthRange.start}
          max={monthRange.end}
          placeholder="To"
        />
        <button
          type="submit"
          className="h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold"
          style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
        >
          Apply
        </button>
        {hasDateFilter && (
          <Link
            href={`/marketing/lead-pulse/monthly-report?year=${year}&month=${month}${sourceCode ? `&source=${sourceCode}` : ""}${region ? `&region=${region}` : ""}`}
            className="h-[36px] px-[10px] rounded-[8px] text-[12px] inline-flex items-center underline"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            Clear date range
          </Link>
        )}
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px]">
        <TripletKpi
          label="L1 Total Leads"
          icon="alt_route"
          thisMonth={totals.l1Leads}
          lastMonth={prevTotals.l1Leads}
          lastMonthLabel={`Last MTD (${prevEffStart.slice(5)}–${prevEffEnd.slice(8)})`}
          avg={avg3.avgL1Leads}
          avgLabel={`Avg ${avg3.months}-mo`}
        />
        <TripletKpi
          label="L2 Total Leads"
          icon="handshake"
          thisMonth={totals.l2Leads}
          lastMonth={prevTotals.l2Leads}
          lastMonthLabel={`Last MTD (${prevEffStart.slice(5)}–${prevEffEnd.slice(8)})`}
          avg={avg3.avgL2Leads}
          avgLabel={`Avg ${avg3.months}-mo`}
        />
        <LpKpi
          label="L1 → L2 %"
          value={totals.l1ConversionPct == null ? "—" : `${totals.l1ConversionPct.toFixed(1)}%`}
          trend={lpPctChange(totals.l1ConversionPct ?? 0, prevTotals.l1ConversionPct ?? 0)}
          icon="trending_up"
          target="Target: 60%"
          subLabel={`Last MTD (${prevEffStart.slice(5)}–${prevEffEnd.slice(8)})`}
          subValue={
            prevTotals.l1ConversionPct == null ? "—" : `${prevTotals.l1ConversionPct.toFixed(1)}%`
          }
        />
        <LpKpi
          label="Closed-Won"
          value={totalWon.toString()}
          trend={lpPctChange(totalWon, prevTotals.l2Won)}
          icon="emoji_events"
          subLabel={`Last MTD (${prevEffStart.slice(5)}–${prevEffEnd.slice(8)})`}
          subValue={prevTotals.l2Won.toString()}
        />
      </div>

      <PerformanceMatrix matrix={matrix} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px]">
        <Card title="Historical Funnel Trends">
          <HistoricalFunnelChart
            data={history.map((h) => ({
              label: h.label,
              l1ConversionPct: h.l1ConversionPct,
              l2ConversionPct: h.l2ConversionPct,
              leads: h.l1Leads + h.l2Leads,
            }))}
          />
          <div
            className="flex items-center gap-[16px] mt-[8px] text-[11px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <Legend color="var(--lp-primary)" label="Total leads" />
            <Legend color="var(--lp-cyan)" label="L1 conversion %" />
            <Legend color="var(--lp-orange)" label="L2 conversion %" />
          </div>
        </Card>
        <Card title="Quick Insight">
          <p className="text-[13px]" style={{ color: "var(--lp-on-surface)" }}>
            {insight || "No insight available yet — submit some entries to generate a narrative."}
          </p>
        </Card>
      </div>
    </div>
  );
}

function PerformanceMatrix({ matrix }: { matrix: Matrix }) {
  const sources = matrix.sources;
  const subColCount = (sources.length + 1) * 3;
  return (
    <div
      className="rounded-[12px] border overflow-hidden"
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      <div className="flex items-center justify-between px-[20px] pt-[16px] pb-[8px]">
        <h2 className="text-[14px] font-semibold">Performance Matrix</h2>
        <div
          className="flex items-center gap-[12px] text-[11px]"
          style={{ color: "var(--lp-on-surface-variant)" }}
        >
          <span>● <span style={{ color: "var(--lp-primary)" }}>Target met (≥30%)</span></span>
          <span>● <span style={{ color: "var(--lp-error)" }}>Critical (&lt;10%)</span></span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table
          className="w-full text-[12px] tabular-nums"
          style={{ minWidth: 200 + sources.length * 180 + 180 }}
        >
          <thead>
            <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
              <th
                className="sticky left-0 z-[2] px-[12px] py-[8px] text-left text-[11px] font-semibold uppercase tracking-[0.05em]"
                style={{
                  backgroundColor: "var(--lp-surface-container-low)",
                  color: "var(--lp-on-surface-variant)",
                  width: 200,
                }}
              >
                BDE
              </th>
              {sources.map((s) => (
                <th
                  key={s.id}
                  colSpan={3}
                  className="px-[8px] py-[8px] text-[11px] font-semibold uppercase tracking-[0.05em] text-center border-l"
                  style={{
                    color: "var(--lp-on-surface-variant)",
                    borderColor: "var(--lp-outline-variant)",
                  }}
                >
                  {s.label}
                </th>
              ))}
              <th
                colSpan={3}
                className="px-[8px] py-[8px] text-[11px] font-semibold uppercase tracking-[0.05em] text-center border-l"
                style={{ color: "var(--lp-primary)", borderColor: "var(--lp-outline-variant)" }}
              >
                Total
              </th>
            </tr>
            <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
              <th
                className="sticky left-0 z-[2]"
                style={{ backgroundColor: "var(--lp-surface-container-low)" }}
              />
              {[...sources, { id: "total", code: "total", label: "Total" }].map((s) => (
                <SubHeader key={s.id} />
              ))}
            </tr>
          </thead>
          <tbody>
            <SectionHeader colSpan={1 + subColCount} label="L1 Team" />
            {(() => {
              const visible = matrix.l1Rows.filter(
                (r) => r.total.leads > 0 || r.total.won > 0,
              );
              const hidden = matrix.l1Rows.length - visible.length;
              return (
                <>
                  {visible.map((r) => (
                    <BdeRow key={r.userId} row={r} sources={sources} />
                  ))}
                  {hidden > 0 && (
                    <HiddenRowsNote
                      colSpan={1 + subColCount}
                      hidden={hidden}
                      names={matrix.l1Rows
                        .filter((r) => r.total.leads === 0 && r.total.won === 0)
                        .map((r) => r.displayName)}
                    />
                  )}
                </>
              );
            })()}
            <SubtotalRow label="Subtotal L1" subtotal={matrix.l1Subtotal} sources={sources} />
            <SectionHeader colSpan={1 + subColCount} label="L2 Team" />
            {(() => {
              const visible = matrix.l2Rows.filter(
                (r) => r.total.leads > 0 || r.total.won > 0,
              );
              const hidden = matrix.l2Rows.length - visible.length;
              return (
                <>
                  {visible.map((r) => (
                    <BdeRow key={r.userId} row={r} sources={sources} />
                  ))}
                  {hidden > 0 && (
                    <HiddenRowsNote
                      colSpan={1 + subColCount}
                      hidden={hidden}
                      names={matrix.l2Rows
                        .filter((r) => r.total.leads === 0 && r.total.won === 0)
                        .map((r) => r.displayName)}
                    />
                  )}
                </>
              );
            })()}
            <SubtotalRow label="Subtotal L2" subtotal={matrix.l2Subtotal} sources={sources} />
            <GlobalRow total={matrix.globalTotal} sources={sources} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubHeader() {
  return (
    <>
      <th
        className="px-[6px] py-[6px] text-right text-[10px] uppercase border-l"
        style={{ color: "var(--lp-on-surface-variant)", borderColor: "var(--lp-outline-variant)" }}
      >
        Leads
      </th>
      <th
        className="px-[6px] py-[6px] text-right text-[10px] uppercase"
        style={{ color: "var(--lp-on-surface-variant)" }}
      >
        Won
      </th>
      <th
        className="px-[6px] py-[6px] text-right text-[10px] uppercase"
        style={{ color: "var(--lp-on-surface-variant)" }}
      >
        %
      </th>
    </>
  );
}

function SectionHeader({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr style={{ backgroundColor: "var(--lp-surface-container-high)" }}>
      <td
        colSpan={colSpan}
        className="px-[12px] py-[6px] text-[10px] uppercase tracking-[0.1em] font-semibold"
        style={{ color: "var(--lp-primary)" }}
      >
        {label}
      </td>
    </tr>
  );
}

/**
 * Tiny "+N hidden — no activity" row that sits just before the
 * sub-total row when one or more BDEs had zero leads + zero won for
 * the current filter. The names show on hover via title attr.
 */
function HiddenRowsNote({
  colSpan,
  hidden,
  names,
}: {
  colSpan: number;
  hidden: number;
  names: string[];
}) {
  return (
    <tr style={{ backgroundColor: "var(--lp-surface-container)" }}>
      <td
        colSpan={colSpan}
        className="px-[12px] py-[4px] text-[11px] italic"
        style={{ color: "var(--lp-on-surface-variant)" }}
        title={names.join(", ")}
      >
        + {hidden} BDE{hidden === 1 ? "" : "s"} hidden — no activity in this filter
      </td>
    </tr>
  );
}

function BdeRow({ row, sources }: { row: MatrixBdeRow; sources: { id: string; code: string; label: string }[] }) {
  return (
    <tr className="border-t hover:bg-white/5" style={{ borderColor: "var(--lp-outline-variant)" }}>
      <td
        className="sticky left-0 px-[12px] py-[6px] font-semibold"
        style={{ backgroundColor: "var(--lp-surface-container)", color: "var(--lp-on-surface)" }}
      >
        <Link
          href={`/marketing/lead-pulse/bde-performance/${row.userId}`}
          className="hover:underline"
        >
          {row.displayName}
        </Link>
      </td>
      {sources.map((s) => {
        const c = row.perSource.get(s.code) ?? { leads: 0, won: 0, conversionPct: null };
        return <Cells key={s.id} cell={c} />;
      })}
      <Cells cell={row.total} bold />
    </tr>
  );
}

function SubtotalRow({
  label,
  subtotal,
  sources,
}: {
  label: string;
  subtotal: { perSource: Map<string, MatrixCell>; total: MatrixCell };
  sources: { id: string; code: string; label: string }[];
}) {
  return (
    <tr
      className="border-t"
      style={{
        borderColor: "var(--lp-outline-variant)",
        backgroundColor: "var(--lp-surface-container-low)",
      }}
    >
      <td
        className="sticky left-0 px-[12px] py-[6px] font-semibold uppercase text-[11px]"
        style={{
          backgroundColor: "var(--lp-surface-container-low)",
          color: "var(--lp-on-surface-variant)",
        }}
      >
        {label}
      </td>
      {sources.map((s) => (
        <Cells
          key={s.id}
          cell={subtotal.perSource.get(s.code) ?? { leads: 0, won: 0, conversionPct: null }}
          subtle
        />
      ))}
      <Cells cell={subtotal.total} bold />
    </tr>
  );
}

function GlobalRow({
  total,
  sources,
}: {
  total: { perSource: Map<string, MatrixCell>; total: MatrixCell };
  sources: { id: string; code: string; label: string }[];
}) {
  return (
    <tr style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}>
      <td
        className="sticky left-0 px-[12px] py-[8px] font-bold uppercase text-[11px]"
        style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
      >
        Global Totals
      </td>
      {sources.map((s) => {
        const c = total.perSource.get(s.code) ?? { leads: 0, won: 0, conversionPct: null };
        return <CellsBlack key={s.id} cell={c} />;
      })}
      <CellsBlack cell={total.total} bold />
    </tr>
  );
}

function Cells({ cell, bold, subtle }: { cell: MatrixCell; bold?: boolean; subtle?: boolean }) {
  const pctColor =
    cell.conversionPct == null
      ? "var(--lp-on-surface-variant)"
      : cell.conversionPct >= 30
        ? "var(--lp-primary)"
        : cell.conversionPct < 10
          ? "var(--lp-error)"
          : "var(--lp-on-surface)";
  const pctWeight = cell.conversionPct != null && cell.conversionPct >= 30 ? 700 : bold ? 600 : 400;
  const dimColor = subtle ? "var(--lp-on-surface-variant)" : "var(--lp-on-surface)";
  return (
    <>
      <td
        className="px-[6px] py-[6px] text-right border-l"
        style={{ borderColor: "var(--lp-outline-variant)", color: dimColor, fontWeight: bold ? 600 : 400 }}
      >
        {cell.leads || ""}
      </td>
      <td
        className="px-[6px] py-[6px] text-right"
        style={{ color: dimColor, fontWeight: bold ? 600 : 400 }}
      >
        {cell.won || ""}
      </td>
      <td
        className="px-[6px] py-[6px] text-right"
        style={{ color: pctColor, fontWeight: pctWeight }}
      >
        {cell.conversionPct == null ? "—" : `${cell.conversionPct.toFixed(1)}%`}
      </td>
    </>
  );
}

function CellsBlack({ cell, bold }: { cell: MatrixCell; bold?: boolean }) {
  return (
    <>
      <td
        className="px-[6px] py-[6px] text-right border-l"
        style={{ borderColor: "rgba(60,47,0,0.3)", fontWeight: bold ? 700 : 600 }}
      >
        {cell.leads || ""}
      </td>
      <td className="px-[6px] py-[6px] text-right" style={{ fontWeight: bold ? 700 : 600 }}>
        {cell.won || ""}
      </td>
      <td className="px-[6px] py-[6px] text-right" style={{ fontWeight: bold ? 700 : 600 }}>
        {cell.conversionPct == null ? "—" : `${cell.conversionPct.toFixed(1)}%`}
      </td>
    </>
  );
}


function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-[12px] border p-[20px]"
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      <h2 className="text-[14px] font-semibold mb-[12px]">{title}</h2>
      {children}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-[4px]">
      <span
        style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: color, display: "inline-block" }}
      />
      {label}
    </span>
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

function DateInput({
  name,
  defaultValue,
  min,
  max,
  placeholder,
}: {
  name: string;
  defaultValue: string;
  min: string;
  max: string;
  placeholder: string;
}) {
  return (
    <label
      className="inline-flex items-center gap-[6px] text-[12px]"
      style={{ color: "var(--lp-on-surface-variant)" }}
    >
      <span>{placeholder}</span>
      <input
        type="date"
        name={name}
        defaultValue={defaultValue}
        min={min}
        max={max}
        className="h-[36px] px-[10px] rounded-[8px] text-[13px]"
      />
    </label>
  );
}

function uniqueYears(
  months: { year: number; month: number }[],
  fallback: number,
): Array<readonly [string, string]> {
  const set = new Set<number>();
  for (const m of months) set.add(m.year);
  set.add(fallback);
  return Array.from(set)
    .sort()
    .reverse()
    .map((y) => [String(y), String(y)] as const);
}

function pctChange(now: number, prev: number): number | null {
  if (prev === 0) return now === 0 ? 0 : null;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}
