"use client";

import { useState } from "react";
import { PERIODS } from "@/lib/sales-analysis";

/** A resolved analysis period (see `resolvePeriod` in sales-analysis.ts). */
export type AnalysisRange = { period: string; from: string; to: string; prevFrom: string; prevTo: string };

export function rangeText(from: string, to: string): string {
  const f = (s: string) =>
    new Date(`${s}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${f(from)} – ${f(to)}`;
}

/**
 * Period presets (this month, last quarter, this FY, …) plus a custom range,
 * shared by the analysis pages — Executive → Sales Analysis and CRM → Lead
 * Quality — so both read periods the same way. The caller owns navigation.
 */
export function AnalysisPeriodBar({
  range,
  onChange,
}: {
  range: AnalysisRange;
  onChange: (period: string, from?: string, to?: string) => void;
}) {
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [custom, setCustom] = useState(range.period === "custom");
  return (
    <div className="flex flex-wrap items-center gap-sm">
      {PERIODS.map((p) => {
        const on = p.value === "custom" ? custom : !custom && range.period === p.value;
        return (
          <button
            key={p.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (p.value === "custom") setCustom(true);
              else {
                setCustom(false);
                onChange(p.value);
              }
            }}
            className={
              "h-9 px-md rounded-lg border text-label-sm font-semibold transition " +
              (on ? "bg-brand text-on-brand border-brand" : "border-outline-variant bg-surface-container-lowest hover:border-primary")
            }
          >
            {p.label}
          </button>
        );
      })}
      {custom && (
        <form
          className="flex items-center gap-xs"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to && from <= to) onChange("custom", from, to);
          }}
        >
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From"
            className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm" />
          <span className="text-on-surface-variant">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To"
            className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm" />
          <button type="submit" className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold">
            Apply
          </button>
        </form>
      )}
      <span className="text-caption text-on-surface-variant ml-auto">{rangeText(range.from, range.to)}</span>
    </div>
  );
}
