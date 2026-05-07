"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { MONTH_LABELS } from "@/lib/period";

export function DateFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const period = search.get("period") ?? "all";
  const fromQ = search.get("from") ?? "";
  const toQ = search.get("to") ?? "";

  const [from, setFrom] = useState(fromQ);
  const [to, setTo] = useState(toQ);

  function applyPreset(p: string) {
    const params = new URLSearchParams(search.toString());
    if (p === "all") {
      params.delete("period");
      params.delete("from");
      params.delete("to");
    } else {
      params.set("period", p);
      params.delete("from");
      params.delete("to");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyCustom() {
    if (!from || !to) return;
    const params = new URLSearchParams(search.toString());
    params.set("period", "custom");
    params.set("from", from);
    params.set("to", to);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-base">
      <select
        value={period}
        onChange={(e) => {
          if (e.target.value !== "custom") applyPreset(e.target.value);
          else applyPreset("custom");
        }}
        className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition"
        aria-label="Date range filter"
      >
        <option value="all">All time</option>
        <option value="fy">FY 2026-27</option>
        <optgroup label="Quarters">
          <option value="q1">Q1 (Apr-Jun)</option>
          <option value="q2">Q2 (Jul-Sep)</option>
          <option value="q3">Q3 (Oct-Dec)</option>
          <option value="q4">Q4 (Jan-Mar)</option>
        </optgroup>
        <optgroup label="Half years">
          <option value="h1">H1 (Apr-Sep)</option>
          <option value="h2">H2 (Oct-Mar)</option>
        </optgroup>
        <optgroup label="Months">
          {MONTH_LABELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </optgroup>
        <option value="custom">Custom range…</option>
      </select>
      {period === "custom" && (
        <div className="flex items-center gap-xs">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none"
          />
          <span className="text-on-surface-variant">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none"
          />
          <button
            type="button"
            onClick={applyCustom}
            disabled={!from || !to}
            className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container disabled:opacity-50 transition"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
