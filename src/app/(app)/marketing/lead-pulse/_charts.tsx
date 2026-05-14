"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  LabelList,
} from "recharts";

const GOLD = "#facc15";
const CYAN = "#33e4ff";
const ORANGE = "#ffb693";
const TEXT = "#d1c6ab";
const GRID = "#4d4632";

export function LeadVolumeChart({
  data,
}: {
  /**
   * Each row: current-window date + leads, plus the matching prior-
   * window date + leads (offset by the window length). When
   * `priorLeads` is present the chart overlays both series; otherwise
   * it falls back to the single-series layout for backwards-compat.
   */
  data: {
    date: string;
    leads: number;
    priorDate?: string;
    priorLeads?: number;
  }[];
}) {
  const hasPrior = data.some((d) => typeof d.priorLeads === "number");
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="lpGold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GOLD} stopOpacity={0.4} />
            <stop offset="100%" stopColor={GOLD} stopOpacity={0.05} />
          </linearGradient>
          {hasPrior && (
            <linearGradient id="lpPrior" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CYAN} stopOpacity={0.15} />
              <stop offset="100%" stopColor={CYAN} stopOpacity={0.02} />
            </linearGradient>
          )}
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => d.slice(5)}
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          width={32}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#231f14", border: `1px solid ${GRID}`, color: "#ebe2d0" }}
          labelStyle={{ color: TEXT }}
          formatter={(value: number, name: string, ctx: { payload?: { priorDate?: string } }) => {
            if (name === "Prior 30d") {
              return [value, `Prior 30d (${ctx.payload?.priorDate ?? ""})`];
            }
            return [value, name];
          }}
        />
        {hasPrior && (
          <Area
            type="monotone"
            dataKey="priorLeads"
            name="Prior 30d"
            stroke={CYAN}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="url(#lpPrior)"
            dot={false}
            isAnimationActive={false}
          />
        )}
        <Area
          type="monotone"
          dataKey="leads"
          name="This 30d"
          stroke={GOLD}
          strokeWidth={2}
          fill="url(#lpGold)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ConversionBySourceChart({
  data,
}: {
  data: { sourceLabel: string; conversionPct: number | null; leads: number }[];
}) {
  const rows = data
    .filter((d) => d.leads > 0)
    .map((d) => ({ ...d, conversionPct: d.conversionPct ?? 0 }))
    .sort((a, b) => b.conversionPct - a.conversionPct);
  if (rows.length === 0) {
    return <p className="text-[12px] py-[24px] text-center" style={{ color: TEXT }}>No data yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, 36 * rows.length)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 30, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={GRID} horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          domain={[0, Math.max(50, ...rows.map((r) => r.conversionPct + 5))]}
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          tickFormatter={(v: number) => `${v}%`}
        />
        <YAxis
          type="category"
          dataKey="sourceLabel"
          width={110}
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#231f14", border: `1px solid ${GRID}`, color: "#ebe2d0" }}
          formatter={(v: number) => `${v.toFixed(1)}%`}
        />
        <Bar dataKey="conversionPct" fill={GOLD} radius={[0, 4, 4, 0]}>
          <LabelList
            dataKey="conversionPct"
            position="right"
            formatter={(v: number) => `${v.toFixed(1)}%`}
            style={{ fill: GOLD, fontSize: 11 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GroupedConversionBySourceChart({
  data,
}: {
  data: {
    sourceLabel: string;
    thisMonthPct: number | null;
    lastMonthPct: number | null;
    avgPct: number | null;
    thisMonthWon: number;
    lastMonthWon: number;
    avgWon: number | null;
  }[];
}) {
  const rows = data
    .map((d) => ({
      sourceLabel: d.sourceLabel,
      thisMonth: d.thisMonthPct ?? 0,
      lastMonth: d.lastMonthPct ?? 0,
      avg3Mo: d.avgPct ?? 0,
      thisMonthWon: d.thisMonthWon,
      lastMonthWon: d.lastMonthWon,
      avg3MoWon: d.avgWon ?? 0,
    }))
    .sort(
      (a, b) =>
        b.thisMonthWon - a.thisMonthWon ||
        b.lastMonthWon - a.lastMonthWon ||
        b.avg3MoWon - a.avg3MoWon ||
        a.sourceLabel.localeCompare(b.sourceLabel),
    );
  const intFmt = (v: number) => (v > 0 ? `${Math.round(v)}` : "");
  return (
    <ResponsiveContainer width="100%" height={Math.max(260, 48 * rows.length)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={GRID} horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          tickFormatter={(v: number) => `${v}%`}
        />
        <YAxis
          type="category"
          dataKey="sourceLabel"
          width={120}
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#231f14", border: `1px solid ${GRID}`, color: "#ebe2d0" }}
          formatter={(v: number, name: string, ctx: { payload?: Record<string, number> }) => {
            const wonKey =
              name === "This month"
                ? "thisMonthWon"
                : name === "Last month"
                  ? "lastMonthWon"
                  : "avg3MoWon";
            const won = ctx.payload?.[wonKey] ?? 0;
            return [`${won} won · ${v.toFixed(1)}%`, name];
          }}
        />
        <Bar dataKey="thisMonth" fill={GOLD} radius={[0, 3, 3, 0]} name="This month">
          <LabelList dataKey="thisMonthWon" position="right" formatter={intFmt} style={{ fill: GOLD, fontSize: 11 }} />
        </Bar>
        <Bar dataKey="lastMonth" fill={CYAN} radius={[0, 3, 3, 0]} name="Last month">
          <LabelList dataKey="lastMonthWon" position="right" formatter={intFmt} style={{ fill: CYAN, fontSize: 11 }} />
        </Bar>
        <Bar dataKey="avg3Mo" fill={ORANGE} radius={[0, 3, 3, 0]} name="3-mo avg">
          <LabelList dataKey="avg3MoWon" position="right" formatter={intFmt} style={{ fill: ORANGE, fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HistoricalFunnelChart({
  data,
}: {
  data: { label: string; l1ConversionPct: number | null; l2ConversionPct: number | null; leads: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: TEXT }} axisLine={{ stroke: GRID }} tickLine={false} />
        <YAxis
          yAxisId="leads"
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          width={36}
        />
        <YAxis
          yAxisId="pct"
          orientation="right"
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          width={32}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#231f14", border: `1px solid ${GRID}`, color: "#ebe2d0" }}
        />
        <Line yAxisId="leads" type="monotone" dataKey="leads" stroke={GOLD} strokeWidth={2} dot />
        <Line yAxisId="pct" type="monotone" dataKey="l1ConversionPct" stroke={CYAN} strokeWidth={2} dot />
        <Line yAxisId="pct" type="monotone" dataKey="l2ConversionPct" stroke={ORANGE} strokeWidth={2} dot />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PerformanceOverTimeChart({
  data,
  role,
}: {
  data: { label: string; leads: number; won: number; conversionPct: number | null }[];
  role: "l1" | "l2";
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: TEXT }} axisLine={{ stroke: GRID }} tickLine={false} />
        <YAxis yAxisId="leads" tick={{ fontSize: 11, fill: TEXT }} axisLine={{ stroke: GRID }} tickLine={false} width={32} />
        <YAxis
          yAxisId="pct"
          orientation="right"
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          width={32}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip contentStyle={{ backgroundColor: "#231f14", border: `1px solid ${GRID}`, color: "#ebe2d0" }} />
        <Line yAxisId="leads" type="monotone" dataKey="leads" stroke={GOLD} strokeWidth={2} dot={false} name="Leads" />
        <Line
          yAxisId="leads"
          type="monotone"
          dataKey="won"
          stroke={CYAN}
          strokeWidth={2}
          dot={false}
          name={role === "l1" ? "Transferred" : "Closed-Won"}
        />
        <Line
          yAxisId="pct"
          type="monotone"
          dataKey="conversionPct"
          stroke={ORANGE}
          strokeWidth={2}
          dot={false}
          name="Conversion %"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
