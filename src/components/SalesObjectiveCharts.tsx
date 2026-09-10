"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inrFull } from "@/lib/format";

// Collection is one measure, so it gets one hue — the brand gold. The two
// shades are provenance, not value: solid gold is DesGro's own ledger, the
// pale step is the frozen archive. Targets are never a second colour: they are
// benchmarks, and benchmarks are drawn as recessive dashed rules so they read
// as "the bar to clear" rather than as a rival series.
const GOLD = "#C9A019";
const GOLD_ARCHIVE = "#E3D08A";
const TARGET_INK = "#424242";
const STRETCH_INK = "#9E9E9E";
const GRID = "#E1E1E1";
const AXIS_INK = "#424242";

function lakhs(v: number) {
  return `${(v / 1_00_000).toFixed(0)}L`;
}

const axisTick = { fontSize: 11, fill: AXIS_INK };

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #D5D5D5",
    fontSize: 12,
    boxShadow: "0 8px 24px -16px rgba(0,0,0,.4)",
  },
  labelStyle: { fontWeight: 600, color: "#1A1A1A" },
} as const;

export type QuarterPoint = {
  short: string;
  collected: number;
  committed: number | null;
  stretch: number | null;
  live: boolean;
};

/**
 * Quarter collection against the committed target. The dashed rule is the
 * target track — it steps because each quarter is targeted off the one before.
 */
export function QuarterTargetChart({ data }: { data: QuarterPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="short" tick={axisTick} axisLine={false} tickLine={false} interval={0} angle={-20} dy={8} height={48} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={lakhs} />
        <Tooltip
          {...tooltipStyle}
          formatter={(value, name) => [
            typeof value === "number" ? inrFull(value) : "not set yet",
            String(name),
          ]}
          cursor={{ fill: "#F5F5F5" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="collected" name="Collected" radius={[3, 3, 0, 0]} maxBarSize={44}>
          {data.map((d) => (
            <Cell key={d.short} fill={d.live ? GOLD : GOLD_ARCHIVE} />
          ))}
        </Bar>
        <Line
          type="stepAfter"
          dataKey="committed"
          name="Committed target (70%)"
          stroke={TARGET_INK}
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          connectNulls={false}
        />
        <Line
          type="stepAfter"
          dataKey="stretch"
          name="Stretch target (2x)"
          stroke={STRETCH_INK}
          strokeWidth={1.5}
          strokeDasharray="2 3"
          dot={false}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export type MonthPoint = {
  label: string;
  collected: number | null;
  target: number | null;
  live: boolean;
};

/**
 * Month-by-month collection against the monthly slice of the committed target.
 * The target line is flat inside a quarter and steps at the quarter boundary,
 * which is exactly how the target is set.
 */
export function MonthlyCollectionChart({
  data,
  ledgerFromLabel,
}: {
  data: MonthPoint[];
  /** X label of the first live month — marks where the ledger takes over. */
  ledgerFromLabel?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 24, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          interval={data.length > 14 ? 1 : 0}
          angle={-38}
          textAnchor="end"
          height={58}
        />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={lakhs} />
        <Tooltip
          {...tooltipStyle}
          formatter={(value, name) => [
            typeof value === "number" ? inrFull(value) : "—",
            String(name),
          ]}
          cursor={{ fill: "#F5F5F5" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {ledgerFromLabel && (
          <ReferenceLine
            x={ledgerFromLabel}
            stroke={GOLD}
            strokeDasharray="2 4"
            label={{ value: "DesGro ledger", position: "top", fontSize: 10, fill: GOLD }}
          />
        )}
        <Bar dataKey="collected" name="Collected" radius={[3, 3, 0, 0]} maxBarSize={26}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.live ? GOLD : GOLD_ARCHIVE} />
          ))}
        </Bar>
        <Line
          type="stepAfter"
          dataKey="target"
          name="Monthly target"
          stroke={TARGET_INK}
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export type AchievementPoint = {
  short: string;
  achievement: number | null;
  /** An open quarter is pace, not a result — its marker is drawn hollow. */
  complete: boolean;
};

/** Solid marker for a closed quarter, hollow for one still running. */
function AchievementDot(props: {
  cx?: number;
  cy?: number;
  payload?: AchievementPoint;
}) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined) return <g />;
  const open = payload ? !payload.complete : false;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={open ? "#FFFFFF" : GOLD}
      stroke={GOLD}
      strokeWidth={2}
    />
  );
}

/**
 * Collection as a share of the committed target, quarter by quarter. 100% is
 * the line the doubling rule asks for; the trend below it is the story the
 * workbook buries in a ratio column.
 */
export function AchievementTrendChart({ data }: { data: AchievementPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="short" tick={axisTick} axisLine={false} tickLine={false} interval={0} angle={-20} dy={8} height={48} />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `${v}%`}
          domain={[0, (max: number) => Math.max(150, Math.ceil(max / 10) * 10)]}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(value) => [
            typeof value === "number" ? `${value.toFixed(1)}% of committed target` : "—",
            "Achievement",
          ]}
          cursor={{ stroke: "#D5D5D5" }}
        />
        <ReferenceLine
          y={100}
          stroke={TARGET_INK}
          strokeWidth={2}
          strokeDasharray="6 3"
          label={{ value: "target", position: "right", fontSize: 10, fill: TARGET_INK }}
        />
        <Line
          type="monotone"
          dataKey="achievement"
          name="Achievement"
          stroke={GOLD}
          strokeWidth={2.5}
          dot={<AchievementDot />}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Compact "x% of target" bar used inside the objective table. */
export function AchievementMeter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-on-surface-variant">—</span>;
  const pct = value * 100;
  const over = pct >= 100;
  return (
    <span className="inline-flex flex-col items-end gap-[3px] w-full">
      <span className="font-semibold">{pct.toFixed(1)}%</span>
      <span
        className="block w-full max-w-[84px] h-[5px] rounded-full bg-surface-container-high overflow-hidden"
        role="img"
        aria-label={`${pct.toFixed(1)} percent of target`}
      >
        <span
          className={"block h-full rounded-full " + (over ? "bg-green-600" : "bg-primary-container")}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </span>
    </span>
  );
}
