"use client";

import { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import type { SourceTrends, TrendMeasure, TrendPeriod } from "@/lib/lead-source-trends";

// Categorical slots stepped for the dark HUD surface and checked as a set
// (CVD + contrast) against it. Colour follows the source, never its rank, and
// "Other" is a neutral grey so it never reads as a ninth source.
const SLOTS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const OTHER = "#8a8370";
const TEXT = "#d1c6ab";
const GRID = "#2a2416";
const SURFACE = "#16130b";
const TOOLTIP_BG = "#14110a";

type View = "daily" | "monthly";

export function SourceTrendsCard({ data }: { data: SourceTrends }) {
  const [view, setView] = useState<View>("daily");
  const [measure, setMeasure] = useState<TrendMeasure>("received");
  const [focus, setFocus] = useState<string | null>(null);

  const periods = view === "daily" ? data.daily : data.monthly;
  const colorOf = (slot: number | null) => (slot == null ? OTHER : SLOTS[slot % SLOTS.length]);

  const rows = useMemo(
    () =>
      periods.map((p) => {
        const row: Record<string, string | number | boolean> = {
          key: p.key,
          short: p.short,
          label: p.label,
          partial: p.partial,
          total: p[measure].reduce((a, n) => a + n, 0),
        };
        p[measure].forEach((n, i) => (row[`s${i}`] = n));
        return row;
      }),
    [periods, measure],
  );
  const seriesTotals = data.series.map((_, i) => periods.reduce((a, p) => a + p[measure][i], 0));
  const grand = seriesTotals.reduce((a, n) => a + n, 0);
  const visible = data.series.map((s, i) => ({ s, i })).filter(({ s }) => focus == null || s.key === focus);
  const topIdx = visible.length ? visible[visible.length - 1].i : -1;
  const windowLabel = view === "daily" ? "last 30 days" : "last 12 months";
  const verb = measure === "received" ? "received" : "assigned";

  if (data.series.length === 0) {
    return (
      <p className="text-[12px] py-[24px] text-center" style={{ color: TEXT }}>
        No CRM leads in the last 12 months yet.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-[8px] mb-[10px]">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "daily", label: "Daily · 30 days" },
            { value: "monthly", label: "Monthly · 12 months" },
          ]}
        />
        <Segmented
          value={measure}
          onChange={setMeasure}
          options={[
            { value: "received", label: "Received" },
            { value: "assigned", label: "Assigned" },
          ]}
        />
        <span className="text-[12px] ml-auto" style={{ color: "var(--lp-on-surface-variant)" }}>
          <span className="font-semibold" style={{ color: "var(--lp-on-surface)" }}>
            {(focus == null ? grand : seriesTotals[data.series.findIndex((s) => s.key === focus)]).toLocaleString("en-IN")}
          </span>{" "}
          {focus == null ? "leads" : `${data.series.find((s) => s.key === focus)?.label} leads`} {verb} · {windowLabel}
        </span>
      </div>

      {/* Legend doubles as the source filter: click a source to see it alone. */}
      <div className="flex flex-wrap gap-[6px] mb-[8px]" role="group" aria-label="Sources">
        {data.series.map((s, i) => {
          const active = focus == null || focus === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setFocus(focus === s.key ? null : s.key)}
              aria-pressed={focus === s.key}
              title={focus === s.key ? "Show all sources" : `Show ${s.label} only`}
              className="inline-flex items-center gap-[6px] h-[26px] px-[8px] rounded-full border text-[11px]"
              style={{
                borderColor: focus === s.key ? "var(--lp-primary)" : "var(--lp-outline-variant)",
                color: "var(--lp-on-surface)",
                opacity: active ? 1 : 0.45,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: colorOf(s.slot), display: "inline-block" }} />
              {s.label}
              <span className="tabular-nums" style={{ color: "var(--lp-on-surface-variant)" }}>
                {seriesTotals[i].toLocaleString("en-IN")}
              </span>
            </button>
          );
        })}
        {focus != null && (
          <button
            type="button"
            onClick={() => setFocus(null)}
            className="h-[26px] px-[8px] text-[11px] underline"
            style={{ color: "var(--lp-primary)" }}
          >
            Show all
          </button>
        )}
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={rows} margin={{ top: 10, right: 6, left: 0, bottom: 0 }} barCategoryGap={view === "daily" ? "18%" : "28%"}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="short"
            tick={{ fontSize: 11, fill: TEXT }}
            axisLine={{ stroke: GRID }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: TEXT }} axisLine={false} tickLine={false} width={36} />
          <Tooltip
            cursor={{ fill: "rgba(250, 204, 21, 0.06)" }}
            content={(props) => (
              <TrendTooltip
                active={props.active}
                row={props.payload?.[0]?.payload as Record<string, string | number | boolean> | undefined}
                series={visible.map(({ s, i }) => ({ label: s.label, color: colorOf(s.slot), idx: i }))}
                verb={verb}
              />
            )}
          />
          {visible.map(({ s, i }) => (
            <Bar
              key={s.key}
              dataKey={`s${i}`}
              name={s.label}
              stackId="src"
              fill={colorOf(s.slot)}
              stroke={SURFACE}
              strokeWidth={visible.length > 1 ? 1 : 0}
              radius={i === topIdx ? [3, 3, 0, 0] : 0}
              isAnimationActive={false}
            >
              {rows.map((r) => (
                <Cell key={String(r.key)} fillOpacity={r.partial ? 0.5 : 1} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-[6px] text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        {measure === "received"
          ? "Received = leads that came into the CRM that day (IST), by source. Duplicates and bulk file uploads are left out — an upload is dated the day it was uploaded, not the day the enquiry came in."
          : "Assigned = leads handed to a BDE that day (IST), by source. Import carryover and duplicates are left out, as in the source table."}{" "}
        The faded bar is {view === "daily" ? "today" : "this month"}, still filling.
      </p>

      <details className="mt-[8px]">
        <summary className="text-[11px] cursor-pointer select-none" style={{ color: "var(--lp-primary)" }}>
          Show the numbers
        </summary>
        <TrendTable periods={periods} measure={measure} series={data.series.map((s) => ({ label: s.label, color: colorOf(s.slot) }))} />
      </details>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-[8px] border p-[2px]" style={{ borderColor: "var(--lp-outline-variant)" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className="h-[28px] px-[10px] rounded-[6px] text-[12px] font-semibold"
            style={{
              backgroundColor: on ? "var(--lp-primary)" : "transparent",
              color: on ? "var(--lp-on-primary)" : "var(--lp-on-surface-variant)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function TrendTooltip({
  active,
  row,
  series,
  verb,
}: {
  active?: boolean;
  row?: Record<string, string | number | boolean>;
  series: Array<{ label: string; color: string; idx: number }>;
  verb: string;
}) {
  if (!active || !row) return null;
  const items = series.map((s) => ({ ...s, n: Number(row[`s${s.idx}`] ?? 0) }));
  const total = items.reduce((a, s) => a + s.n, 0);
  return (
    <div
      className="rounded-[8px] px-[10px] py-[8px] text-[12px]"
      style={{ backgroundColor: TOOLTIP_BG, border: `1px solid ${GRID}`, color: "#ebe2d0", minWidth: 170 }}
    >
      <p style={{ color: TEXT }} className="mb-[4px]">
        {String(row.label)}
        {row.partial ? " · so far" : ""}
      </p>
      <p className="mb-[6px]">
        <span className="font-bold tabular-nums">{total.toLocaleString("en-IN")}</span>{" "}
        <span style={{ color: TEXT }}>{verb}</span>
      </p>
      {items
        .filter((s) => s.n > 0)
        .reverse()
        .map((s) => (
          <p key={s.idx} className="flex items-center gap-[6px] leading-[18px]">
            <span style={{ width: 10, height: 2, background: s.color, display: "inline-block" }} />
            <span className="font-semibold tabular-nums" style={{ minWidth: 28 }}>
              {s.n.toLocaleString("en-IN")}
            </span>
            <span style={{ color: TEXT }}>{s.label}</span>
          </p>
        ))}
    </div>
  );
}

function TrendTable({
  periods,
  measure,
  series,
}: {
  periods: TrendPeriod[];
  measure: TrendMeasure;
  series: Array<{ label: string; color: string }>;
}) {
  const cell = "px-[8px] py-[4px] text-right whitespace-nowrap";
  return (
    <div className="overflow-x-auto mt-[6px]">
      <table className="text-[12px] tabular-nums">
        <thead>
          <tr style={{ color: "var(--lp-on-surface-variant)" }}>
            <th className="px-[8px] py-[4px] text-left sticky left-0" style={{ backgroundColor: SURFACE }}>
              Source
            </th>
            {periods.map((p) => (
              <th key={p.key} className={cell} title={p.label}>
                {p.short}
              </th>
            ))}
            <th className={cell}>Total</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s, i) => (
            <tr key={s.label} style={{ borderTop: "1px solid var(--lp-outline-variant)" }}>
              <td className="px-[8px] py-[4px] whitespace-nowrap sticky left-0" style={{ backgroundColor: SURFACE }}>
                <span className="inline-flex items-center gap-[6px]">
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />
                  {s.label}
                </span>
              </td>
              {periods.map((p) => (
                <td key={p.key} className={cell}>
                  {p[measure][i] ? p[measure][i].toLocaleString("en-IN") : <span style={{ opacity: 0.35 }}>·</span>}
                </td>
              ))}
              <td className={cell + " font-semibold"}>
                {periods.reduce((a, p) => a + p[measure][i], 0).toLocaleString("en-IN")}
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: "1px solid var(--lp-outline-variant)", color: "var(--lp-primary)" }}>
            <td className="px-[8px] py-[4px] font-semibold uppercase text-[11px] sticky left-0" style={{ backgroundColor: SURFACE }}>
              Total
            </td>
            {periods.map((p) => (
              <td key={p.key} className={cell + " font-semibold"}>
                {p[measure].reduce((a, n) => a + n, 0).toLocaleString("en-IN")}
              </td>
            ))}
            <td className={cell + " font-semibold"}>
              {periods.reduce((a, p) => a + p[measure].reduce((x, n) => x + n, 0), 0).toLocaleString("en-IN")}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
