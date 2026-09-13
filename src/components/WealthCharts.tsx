"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inrCompact, inrFull } from "@/lib/format";

/**
 * Charts for the Personal Wealth desk.
 *
 * Series colours come from lib/wealth's ASSET_CLASS_META, which is a validated
 * categorical palette: each hue was checked for the lightness band, the chroma
 * floor, colour-vision separation between neighbours, and contrast against a
 * white card. Colour follows the asset class, never its rank — hiding business
 * rows must not repaint the classes that remain.
 *
 * Status colours (red for money owed, amber for a heavy month) are reserved and
 * never reused as a series, and each one is paired with a label so the meaning
 * never rests on colour alone.
 */

const GRID = "#E1E1E1";
const AXIS_INK = "#424242";
const INK = "#1A1A1A";
const CRITICAL = "#BA1A1A";
const WARNING = "#B45309";
const NEUTRAL_BAR = "#2563EB";

const axisTick = { fontSize: 11, fill: AXIS_INK };

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #D5D5D5",
    fontSize: 12,
    padding: "8px 10px",
  },
  labelStyle: { fontWeight: 600, color: INK },
};

function lakhAxis(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_00_00_000) return `${(v / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `${Math.round(v / 1_00_000)}L`;
  if (abs === 0) return "0";
  return `${Math.round(v / 1000)}k`;
}

// ── Allocation ──────────────────────────────────────────────────────────────

export type AllocationDatum = { label: string; value: number; share: number; color: string };

/**
 * Where the money sits, by asset class. A ranked horizontal bar rather than a
 * donut: the question this answers is "which of these is biggest, and by how
 * much", and length is read far more accurately than angle. No legend — each
 * bar is labelled on the axis, so identity never rests on the colour.
 */
export function AllocationChart({ data }: { data: AllocationDatum[] }) {
  if (data.length === 0) return <EmptyChart label="Nothing to allocate yet" />;
  const height = Math.max(160, data.length * 38 + 24);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 68, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tickFormatter={lakhAxis} tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          tick={axisTick}
          width={150}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          formatter={(v: number, _n, item) => [
            `${inrFull(v)} · ${((item?.payload?.share ?? 0) * 100).toFixed(1)}%`,
            "Value",
          ]}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.color} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v: number) => inrCompact(v)}
            style={{ fontSize: 11, fontWeight: 600, fill: AXIS_INK }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Net-worth bridge ────────────────────────────────────────────────────────

export type BridgeStep = { label: string; value: number; kind: "add" | "sub" | "total" };

/**
 * How net worth is built: assets stacked up, borrowings taken back off, the
 * result standing on its own. A waterfall drawn as a stacked bar — an invisible
 * base positions each floating step — because the running balance is the point,
 * and a plain bar chart would hide it.
 */
export function NetWorthBridge({ steps }: { steps: BridgeStep[] }) {
  if (steps.length === 0) return <EmptyChart label="Nothing to chart yet" />;

  let running = 0;
  const data = steps.map((s) => {
    let base: number;
    let span: number;
    if (s.kind === "total") {
      base = 0;
      span = Math.max(0, s.value);
    } else if (s.kind === "add") {
      base = running;
      span = s.value;
      running += s.value;
    } else {
      // A subtraction floats from the new, lower running total up to the old one.
      span = Math.abs(s.value);
      running -= span;
      base = running;
    }
    return { ...s, base, span, display: Math.abs(s.value) };
  });

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 22, right: 8, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
        <YAxis tickFormatter={lakhAxis} tick={axisTick} axisLine={false} tickLine={false} width={44} />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          formatter={(_v, _n, item) => {
            const p = item?.payload;
            if (!p) return ["", ""];
            return [`${p.kind === "sub" ? "− " : ""}${inrFull(p.display)}`, p.label];
          }}
          labelFormatter={() => ""}
        />
        {/* The invisible pedestal that floats each step to its running total. */}
        <Bar dataKey="base" stackId="bridge" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="span" stackId="bridge" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell
              key={d.label}
              fill={d.kind === "sub" ? CRITICAL : d.kind === "total" ? "#1F1F1F" : d.kind === "add" ? NEUTRAL_BAR : NEUTRAL_BAR}
            />
          ))}
          <LabelList
            dataKey="display"
            position="top"
            formatter={(v: number) => inrCompact(v)}
            style={{ fontSize: 11, fontWeight: 600, fill: AXIS_INK }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Committed outflow ───────────────────────────────────────────────────────

export type OutflowMonth = { label: string; total: number; count: number; heavy: boolean };

/**
 * What is already promised, month by month. The amber bars are the months a
 * renewal lands on top of the usual instalments — the ones worth funding early.
 * Amber is a status, so it carries the "heavy month" label in the tooltip
 * rather than relying on the reader to decode the colour.
 */
export function OutflowChart({ data }: { data: OutflowMonth[] }) {
  if (data.length === 0) return <EmptyChart label="Nothing scheduled yet" />;

  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} margin={{ top: 18, right: 8, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
        <YAxis tickFormatter={lakhAxis} tick={axisTick} axisLine={false} tickLine={false} width={44} />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          formatter={(v: number, _n, item) => {
            const p = item?.payload as OutflowMonth | undefined;
            const suffix = p ? ` · ${p.count} item${p.count === 1 ? "" : "s"}${p.heavy ? " · heavy month" : ""}` : "";
            return [`${inrFull(v)}${suffix}`, "Committed"];
          }}
        />
        <Bar dataKey="total" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.heavy ? WARNING : NEUTRAL_BAR} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[180px] grid place-items-center text-caption text-on-surface-variant">{label}</div>
  );
}
