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
  ComposedChart,
  FunnelChart,
  Funnel,
  Cell,
} from "recharts";

// Series colours are unchanged (gold/cyan/orange); only the chart *chrome*
// (grid lines + tooltip surface) is deepened to match the Futuristic HUD base.
const GOLD = "#facc15";
const CYAN = "#33e4ff";
const ORANGE = "#ffb693";
const TEXT = "#d1c6ab";
const GRID = "#403a28";
const TOOLTIP_BG = "#14110a";

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
          contentStyle={{ backgroundColor: TOOLTIP_BG, border: `1px solid ${GRID}`, color: "#ebe2d0" }}
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
          contentStyle={{ backgroundColor: TOOLTIP_BG, border: `1px solid ${GRID}`, color: "#ebe2d0" }}
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
          allowDecimals={false}
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
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
          contentStyle={{ backgroundColor: TOOLTIP_BG, border: `1px solid ${GRID}`, color: "#ebe2d0" }}
          formatter={(v: number) => [`${Math.round(v)} won`, ""]}
        />
        <Bar dataKey="thisMonthWon" fill={GOLD} radius={[0, 3, 3, 0]} name="This month">
          <LabelList dataKey="thisMonthWon" position="right" formatter={intFmt} style={{ fill: GOLD, fontSize: 11 }} />
        </Bar>
        <Bar dataKey="lastMonthWon" fill={CYAN} radius={[0, 3, 3, 0]} name="Last month">
          <LabelList dataKey="lastMonthWon" position="right" formatter={intFmt} style={{ fill: CYAN, fontSize: 11 }} />
        </Bar>
        <Bar dataKey="avg3MoWon" fill={ORANGE} radius={[0, 3, 3, 0]} name="3-mo avg">
          <LabelList dataKey="avg3MoWon" position="right" formatter={intFmt} style={{ fill: ORANGE, fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Reverse / goal-seek funnel for the Growth Planner. Stages run top→bottom
 * (Leads needed → Connected → Quotes → Enrollments) tapering to the target,
 * so the volume required at each stage to hit the goal reads at a glance.
 */
export function ReverseFunnelChart({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  // Gold → amber → cyan → orange ramp, matching the HUD palette.
  const palette = [GOLD, "#f0b429", CYAN, ORANGE];
  const rows = data.map((d, i) => ({ ...d, fill: palette[i % palette.length] }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <FunnelChart margin={{ top: 8, right: 120, bottom: 8, left: 8 }}>
        <Tooltip
          contentStyle={{ backgroundColor: TOOLTIP_BG, border: `1px solid ${GRID}`, color: "#ebe2d0" }}
          formatter={(v: number) => [v.toLocaleString("en-IN"), "Required"]}
        />
        <Funnel
          dataKey="value"
          data={rows}
          isAnimationActive={false}
          lastShapeType="triangle"
          stroke={TOOLTIP_BG}
        >
          <LabelList
            position="right"
            dataKey="name"
            stroke="none"
            fill={TEXT}
            fontSize={12}
          />
          <LabelList
            position="center"
            dataKey="value"
            stroke="none"
            fill="#14110a"
            fontSize={13}
            fontWeight={700}
            formatter={(v: number) => v.toLocaleString("en-IN")}
          />
          {rows.map((r, i) => (
            <Cell key={i} fill={r.fill} />
          ))}
        </Funnel>
      </FunnelChart>
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
          contentStyle={{ backgroundColor: TOOLTIP_BG, border: `1px solid ${GRID}`, color: "#ebe2d0" }}
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
        <Tooltip contentStyle={{ backgroundColor: TOOLTIP_BG, border: `1px solid ${GRID}`, color: "#ebe2d0" }} />
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

/**
 * Composed monthly bar (disqualified count) + line (disqualification %)
 * chart for the Meta Disqualified analysis card.
 */
export function DisqualifiedMonthlyChart({
  data,
}: {
  data: { label: string; count: number; leads: number; pct: number | null }[];
}) {
  const rows = data.map((d) => ({ ...d, pctVal: d.pct ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={rows} margin={{ top: 14, right: 18, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: TEXT }} axisLine={{ stroke: GRID }} tickLine={false} />
        <YAxis
          yAxisId="count"
          allowDecimals={false}
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          width={32}
        />
        <YAxis
          yAxisId="pct"
          orientation="right"
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          width={40}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          contentStyle={{ backgroundColor: TOOLTIP_BG, border: `1px solid ${GRID}`, color: "#ebe2d0" }}
          formatter={(v: number, name: string) => {
            if (name === "Disqualified %") return [`${v.toFixed(1)}%`, name];
            return [v, name];
          }}
        />
        <Bar yAxisId="count" dataKey="count" fill={ORANGE} radius={[4, 4, 0, 0]} name="Disqualified">
          <LabelList
            dataKey="count"
            position="top"
            formatter={(v: number) => (v > 0 ? String(v) : "")}
            style={{ fill: ORANGE, fontSize: 11 }}
          />
        </Bar>
        <Line
          yAxisId="pct"
          type="monotone"
          dataKey="pctVal"
          stroke={GOLD}
          strokeWidth={2}
          dot={{ r: 3, fill: GOLD }}
          name="Disqualified %"
        >
          <LabelList
            dataKey="pctVal"
            position="top"
            offset={10}
            formatter={(v: number) => (v > 0 ? `${v.toFixed(1)}%` : "")}
            style={{ fill: GOLD, fontSize: 10 }}
          />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** 30d vs prior-30d overlay for disqualified leads. Mirrors LeadVolumeChart styling. */
export function DisqualifiedDailyChart({
  data,
}: {
  data: { date: string; count: number; priorDate: string; priorCount: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="disqCurr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ORANGE} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ORANGE} stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="disqPrior" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN} stopOpacity={0.15} />
            <stop offset="100%" stopColor={CYAN} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => d.slice(5)}
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: TEXT }} axisLine={{ stroke: GRID }} tickLine={false} width={32} />
        <Tooltip
          contentStyle={{ backgroundColor: TOOLTIP_BG, border: `1px solid ${GRID}`, color: "#ebe2d0" }}
          formatter={(value: number, name: string, ctx: { payload?: { priorDate?: string } }) => {
            if (name === "Prior 30d") {
              return [value, `Prior 30d (${ctx.payload?.priorDate ?? ""})`];
            }
            return [value, name];
          }}
        />
        <Area
          type="monotone"
          dataKey="priorCount"
          name="Prior 30d"
          stroke={CYAN}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          fill="url(#disqPrior)"
          dot={false}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="count"
          name="This 30d"
          stroke={ORANGE}
          strokeWidth={2}
          fill="url(#disqCurr)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Horizontal bar chart comparing each BDE's monthly actual against
 * their target. Two side-by-side bars per BDE — gold (actual) and
 * cyan (target) — so the gap reads at a glance.
 */
export function TargetAchievementChart({
  data,
}: {
  data: Array<{ name: string; actual: number; target: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, 48 * data.length)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 6, right: 40, left: 8, bottom: 4 }}
      >
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 11, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={100}
          tick={{ fontSize: 12, fill: TEXT }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ backgroundColor: TOOLTIP_BG, border: `1px solid ${GRID}`, color: "#ebe2d0" }}
          formatter={(v: number) => [v, ""]}
        />
        <Bar dataKey="actual" fill={GOLD} radius={[0, 4, 4, 0]} name="Actual">
          <LabelList
            dataKey="actual"
            position="right"
            formatter={(v: number) => (v > 0 ? String(Math.round(v * 10) / 10) : "")}
            style={{ fill: GOLD, fontSize: 11 }}
          />
        </Bar>
        <Bar dataKey="target" fill={CYAN} radius={[0, 4, 4, 0]} name="Target">
          <LabelList
            dataKey="target"
            position="right"
            formatter={(v: number) => (v > 0 ? String(v) : "")}
            style={{ fill: CYAN, fontSize: 11 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
