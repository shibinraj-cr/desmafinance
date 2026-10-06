"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Section } from "@/components/Cards";
import { MultiSelect } from "@/components/MultiSelect";
import { inr } from "@/lib/format";
import {
  COLLECTION_ONLY_DIMS,
  DIM_LABELS,
  ENROLLMENT_ONLY_DIMS,
  MEASURES,
  MEASURE_META,
  NOT_APPLICABLE,
  OTHER_KEY,
  PERIODS,
  RATIO_MEASURES,
  STORED_DIMS,
  TIME_DIMS,
  dayFromYmd,
  decodeFact,
  deltaPct,
  dimOptions,
  isTimeDim,
  measureValue,
  pivot,
  type Acc,
  type DimKey,
  type Filters,
  type MeasureKey,
  type PivotRow,
} from "@/lib/sales-analysis";
import type { SalesAnalysisPayload } from "@/lib/sales-analysis-data";

type Range = { period: string; from: string; to: string; prevFrom: string; prevTo: string };

const ALL_DIMS: DimKey[] = [...STORED_DIMS, ...TIME_DIMS];

/** Split-series colours — validated for CVD separation; "Other" is neutral. */
const SERIES = ["#C9A019", "#2E6DB4", "#B5532F", "#8E5BB5", "#1B9E77"];
const OTHER_COLOR = "#9E9E9E";

/** Ready-made cuts — one click sets measure, rows and split. */
const PRESETS: Array<{ label: string; measure: MeasureKey; by: DimKey; split?: DimKey }> = [
  { label: "Sales by source", measure: "enrollments", by: "source" },
  { label: "Sales by BDE", measure: "enrollments", by: "bde" },
  { label: "Revenue by service", measure: "collected", by: "service" },
  { label: "Monthly trend", measure: "booked", by: "month" },
  { label: "Source conversion", measure: "conversion", by: "source" },
  { label: "BDE × service", measure: "enrollments", by: "bde", split: "service" },
  { label: "Source × month", measure: "enrollments", by: "month", split: "source" },
  { label: "Collections by BDE", measure: "collected", by: "bde", split: "revenueCategory" },
  { label: "Payment modes", measure: "collected", by: "paymentMode" },
  { label: "Lead → close speed", measure: "enrollments", by: "closeSpeed" },
];

/** Where a drill-down goes next after filtering on a row. */
const DRILL_NEXT: Partial<Record<DimKey, DimKey>> = {
  source: "bde",
  originalSource: "bde",
  bde: "service",
  service: "source",
  serviceGroup: "service",
  qualification: "source",
  country: "source",
  destination: "service",
  campaign: "bde",
  temperature: "bde",
  customerType: "service",
  revenueCategory: "service",
  paymentMode: "bde",
  market: "service",
  closeSpeed: "bde",
  month: "source",
  quarter: "month",
  week: "source",
  weekday: "source",
};

function fmt(m: MeasureKey, v: number | null): string {
  if (v === null) return "—";
  switch (MEASURE_META[m].format) {
    case "count":
      return Math.round(v).toLocaleString("en-IN");
    case "decimal":
      return v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
    case "inr":
      return inr(v);
    case "pct":
      return `${v.toFixed(1)}%`;
  }
}

function isDim(v: string | null): v is DimKey {
  return !!v && (ALL_DIMS as string[]).includes(v);
}

function isMeasure(v: string | null): v is MeasureKey {
  return !!v && (MEASURES as readonly string[]).includes(v);
}

function rangeText(from: string, to: string): string {
  const f = (s: string) =>
    new Date(`${s}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${f(from)} – ${f(to)}`;
}

export function SalesAnalysisView({ payload, range }: { payload: SalesAnalysisPayload; range: Range }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const facts = useMemo(() => payload.facts.map(decodeFact), [payload.facts]);
  const dicts = payload.dicts;
  const cur = useMemo(() => ({ from: dayFromYmd(range.from), to: dayFromYmd(range.to) }), [range.from, range.to]);
  const prev = useMemo(() => ({ from: dayFromYmd(range.prevFrom), to: dayFromYmd(range.prevTo) }), [range.prevFrom, range.prevTo]);
  const currentFacts = useMemo(() => facts.filter((f) => f.day >= cur.from && f.day <= cur.to), [facts, cur]);

  // ── Analysis state (client-side; mirrored into the URL so a view can be shared) ──
  const [measure, setMeasure] = useState<MeasureKey>(() => (isMeasure(search.get("m")) ? (search.get("m") as MeasureKey) : "enrollments"));
  const [by, setBy] = useState<DimKey>(() => (isDim(search.get("by")) ? (search.get("by") as DimKey) : "source"));
  const [split, setSplit] = useState<DimKey | null>(() => (isDim(search.get("split")) ? (search.get("split") as DimKey) : null));
  const [filters, setFilters] = useState<Filters>(() => {
    const out: Filters = {};
    for (const d of ALL_DIMS) {
      const v = search.getAll(`f_${d}`);
      if (v.length) out[d] = v;
    }
    return out;
  });
  const [sortBy, setSortBy] = useState<MeasureKey | null>(null);
  const [topN, setTopN] = useState(25);

  useEffect(() => {
    const p = new URLSearchParams();
    for (const k of ["period", "from", "to"]) {
      const v = search.get(k);
      if (v) p.set(k, v);
    }
    p.set("m", measure);
    p.set("by", by);
    if (split) p.set("split", split);
    for (const [d, keys] of Object.entries(filters)) for (const k of keys ?? []) p.append(`f_${d}`, k);
    window.history.replaceState(null, "", `${pathname}?${p.toString()}`);
  }, [measure, by, split, filters, pathname, search]);

  const effectiveSort = sortBy ?? measure;
  const result = useMemo(
    () => pivot({ facts, dicts, rowDim: by, colDim: split, filters, range: cur, prevRange: prev, sortBy: effectiveSort, topN }),
    [facts, dicts, by, split, filters, cur, prev, effectiveSort, topN],
  );

  const activeFilters = Object.entries(filters).filter(([, v]) => v && v.length > 0) as Array<[DimKey, string[]]>;

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setMeasure(p.measure);
    setBy(p.by);
    setSplit(p.split ?? null);
    setSortBy(null);
  };

  const drill = (row: PivotRow) => {
    if (row.key === OTHER_KEY) return;
    setFilters((f) => ({ ...f, [by]: [row.key] }));
    const next = DRILL_NEXT[by];
    if (next && next !== split) setBy(next);
  };

  const setPeriod = (period: string, from?: string, to?: string) => {
    const p = new URLSearchParams(window.location.search);
    p.set("period", period);
    if (period === "custom" && from && to) {
      p.set("from", from);
      p.set("to", to);
    } else {
      p.delete("from");
      p.delete("to");
    }
    router.push(`${pathname}?${p.toString()}`);
  };

  const onlyHint = COLLECTION_ONLY_DIMS.includes(by) || (split && COLLECTION_ONLY_DIMS.includes(split))
    ? "Payment mode, revenue category and export/domestic exist only on collections — enrollments and leads show as “Not applicable”."
    : ENROLLMENT_ONLY_DIMS.includes(by) || (split && ENROLLMENT_ONLY_DIMS.includes(split))
      ? "Lead → close time exists only on enrollments (days from lead created to deal closed)."
      : null;

  return (
    <div className="p-margin space-y-lg">
      <PeriodBar range={range} onChange={setPeriod} />

      {/* KPI tiles — each one picks the measure the rest of the page analyses. */}
      <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-gutter">
        {MEASURES.map((m) => {
          const v = measureValue(result.total, m);
          const d = deltaPct(v, measureValue(result.prevTotal, m));
          const active = m === measure;
          return (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMeasure(m);
                setSortBy(null);
              }}
              title={MEASURE_META[m].hint}
              className={
                "text-left p-md rounded-xl border shadow-sm transition " +
                (active
                  ? "border-primary ring-2 ring-primary/30 bg-surface-container-lowest"
                  : "border-outline-variant bg-surface-container-lowest hover:border-primary/60")
              }
            >
              <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{MEASURE_META[m].label}</p>
              <p className="text-h2 text-on-surface mt-xs font-mono">{fmt(m, v)}</p>
              <p className="text-caption text-on-surface-variant mt-xs">
                <DeltaChip pct={d} /> vs prev. {fmt(m, measureValue(result.prevTotal, m))}
              </p>
            </button>
          );
        })}
      </section>

      <Section title="">
        {/* Presets */}
        <div className="flex flex-wrap gap-sm mb-md">
          {PRESETS.map((p) => {
            const on = p.measure === measure && p.by === by && (p.split ?? null) === split;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className={
                  "h-8 px-md rounded-full border text-label-sm font-semibold transition " +
                  (on ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface hover:border-primary")
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Builder */}
        <div className="flex flex-wrap items-center gap-sm text-body-md">
          <span className="text-on-surface-variant">Show</span>
          <Select value={measure} onChange={(v) => { setMeasure(v as MeasureKey); setSortBy(null); }} label="Measure"
            options={MEASURES.map((m) => ({ value: m, label: MEASURE_META[m].label }))} />
          <span className="text-on-surface-variant">by</span>
          <Select value={by} onChange={(v) => setBy(v as DimKey)} label="Group by" options={dimSelectOptions()} />
          <span className="text-on-surface-variant">split by</span>
          <Select value={split ?? ""} onChange={(v) => setSplit(v ? (v as DimKey) : null)} label="Split by"
            options={[{ value: "", label: "— none —" }, ...dimSelectOptions().filter((o) => o.value !== by)]} />
          <span className="text-on-surface-variant ml-md">rows</span>
          <Select value={String(topN)} onChange={(v) => setTopN(Number(v))} label="Top rows"
            options={[10, 25, 50, 200].map((n) => ({ value: String(n), label: `Top ${n}` }))} />
          <AddFilter
            exclude={activeFilters.map(([d]) => d)}
            onAdd={(d) => setFilters((f) => ({ ...f, [d]: f[d] ?? [] }))}
          />
        </div>

        {/* Filters */}
        {Object.keys(filters).length > 0 && (
          <div className="flex flex-wrap items-center gap-sm mt-md">
            {(Object.keys(filters) as DimKey[]).map((d) => (
              <div key={d} className="flex items-center gap-xs">
                <span className="text-label-sm text-on-surface-variant">{DIM_LABELS[d]}</span>
                <MultiSelect
                  options={dimOptions(currentFacts, d, dicts).map((o) => ({ value: o.value, label: o.label, hint: String(o.count) }))}
                  selected={filters[d] ?? []}
                  onChange={(next) => setFilters((f) => ({ ...f, [d]: next }))}
                  placeholder={`All`}
                />
                <button
                  type="button"
                  aria-label={`Remove ${DIM_LABELS[d]} filter`}
                  onClick={() =>
                    setFilters((f) => {
                      const n = { ...f };
                      delete n[d];
                      return n;
                    })
                  }
                  className="material-symbols-outlined text-[18px] text-on-surface-variant hover:text-error"
                >
                  close
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setFilters({})} className="text-label-sm text-accent font-semibold hover:underline">
              Clear all
            </button>
          </div>
        )}
        {onlyHint && <p className="text-caption text-on-surface-variant mt-sm">{onlyHint}</p>}
      </Section>

      <Section
        title={`${MEASURE_META[measure].label} by ${DIM_LABELS[by]}${split ? ` × ${DIM_LABELS[split]}` : ""}`}
        action={<span className="text-caption text-on-surface-variant">{rangeText(range.from, range.to)}</span>}
      >
        <AnalysisChart result={result} measure={measure} by={by} split={split} />
      </Section>

      <Section
        title="Breakdown"
        action={
          <button
            type="button"
            onClick={() => downloadCsv(result, measure, by, split)}
            className="h-8 px-md rounded-lg border border-outline-variant text-label-sm font-semibold hover:border-primary"
          >
            Export CSV
          </button>
        }
      >
        {split ? (
          <SplitTable result={result} measure={measure} by={by} onDrill={drill} />
        ) : (
          <FlatTable result={result} measure={measure} by={by} sortBy={effectiveSort} onSort={setSortBy} onDrill={drill} />
        )}
        <p className="text-caption text-on-surface-variant mt-md">
          Click a row to drill in: it becomes a filter and the view moves to the next dimension. Enrollments are CRM
          deals closed-won in the period (BDE, source and service as recorded on the deal). Booked value is the
          package amount on the candidate&apos;s finance record, falling back to the deal value. Collected revenue is
          finance Revenue dated in the period, attributed to the candidate&apos;s closing BDE and source. Leads are
          CRM leads created in the period, duplicates excluded. Deltas compare with the {rangeText(range.prevFrom, range.prevTo)} window.
        </p>
      </Section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
        {(["source", "bde", "service"] as DimKey[]).map((d) => (
          <Leaderboard
            key={d}
            title={`Top ${DIM_LABELS[d].toLowerCase()}s`}
            measure={measure}
            onPick={() => {
              setBy(d);
              setSplit(null);
            }}
            rows={
              pivot({ facts, dicts, rowDim: d, filters, range: cur, prevRange: prev, sortBy: measure, topN: 5 }).rows
            }
          />
        ))}
      </section>
    </div>
  );
}

function dimSelectOptions() {
  return ALL_DIMS.map((d) => ({ value: d, label: DIM_LABELS[d] }));
}

// ── Controls ─────────────────────────────────────────────────────────────────

function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  label: string;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function AddFilter({ exclude, onAdd }: { exclude: DimKey[]; onAdd: (d: DimKey) => void }) {
  return (
    <select
      value=""
      aria-label="Add filter"
      onChange={(e) => {
        if (isDim(e.target.value)) onAdd(e.target.value);
      }}
      className="h-9 px-md rounded-lg border border-dashed border-outline-variant bg-surface-container-lowest text-accent text-label-sm font-semibold outline-none"
    >
      <option value="">+ Add filter</option>
      {ALL_DIMS.filter((d) => !exclude.includes(d)).map((d) => (
        <option key={d} value={d}>
          {DIM_LABELS[d]}
        </option>
      ))}
    </select>
  );
}

function PeriodBar({ range, onChange }: { range: Range; onChange: (period: string, from?: string, to?: string) => void }) {
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

function DeltaChip({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="font-semibold">—</span>;
  const up = pct >= 0;
  return (
    <span className={"font-semibold " + (up ? "text-green-700" : "text-error")}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

// ── Chart ────────────────────────────────────────────────────────────────────

function AnalysisChart({
  result,
  measure,
  by,
  split,
}: {
  result: ReturnType<typeof pivot>;
  measure: MeasureKey;
  by: DimKey;
  split: DimKey | null;
}) {
  const time = isTimeDim(by);
  const rows = (time ? result.rows : result.rows.slice(0, 15)).filter((r) => r.acc.enrollments + r.acc.collected + r.acc.leads > 0);
  if (rows.length === 0) {
    return <div className="py-xl text-center text-on-surface-variant">No data for this period and filter.</div>;
  }
  const additive = !RATIO_MEASURES.includes(measure);
  const data = rows.map((r) => {
    const point: Record<string, string | number | null> = { name: r.label, value: measureValue(r.acc, measure) };
    for (const c of result.columns) point[c.key] = r.cells[c.key] ? measureValue(r.cells[c.key], measure) : null;
    return point;
  });
  const colorOf = (key: string, i: number) => (key === OTHER_KEY || key === NOT_APPLICABLE ? OTHER_COLOR : SERIES[i % SERIES.length]);
  const tick = (v: number) => (MEASURE_META[measure].format === "inr" ? inr(v) : MEASURE_META[measure].format === "pct" ? `${v}%` : String(v));
  const tooltipFormatter = (v: number) => fmt(measure, v);

  const bars = split
    ? result.columns.map((c, i) => (
        <Bar
          key={c.key}
          dataKey={c.key}
          name={c.label}
          stackId={additive ? "s" : undefined}
          fill={colorOf(c.key, i)}
          stroke="#ffffff"
          strokeWidth={1}
          maxBarSize={36}
        />
      ))
    : [<Bar key="v" dataKey="value" name={MEASURE_META[measure].label} fill={SERIES[0]} radius={time ? [4, 4, 0, 0] : [0, 4, 4, 0]} maxBarSize={36} />];

  if (time) {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e1e2e9" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={tick} width={70} />
          <Tooltip formatter={tooltipFormatter} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          {split && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {bars}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 30 + 60)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e2e9" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={tick} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={170} interval={0} />
        <Tooltip formatter={tooltipFormatter} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        {split && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {bars}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────

function Th({ children, right, active, onClick }: { children: React.ReactNode; right?: boolean; active?: boolean; onClick?: () => void }) {
  return (
    <th
      onClick={onClick}
      className={
        "py-sm pr-md text-label-sm uppercase whitespace-nowrap " +
        (right ? "text-right " : "text-left ") +
        (active ? "text-on-surface " : "") +
        (onClick ? "cursor-pointer select-none hover:text-on-surface" : "")
      }
    >
      {children}
    </th>
  );
}

function Num({ children, strong, muted }: { children: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <td
      className={
        "py-sm pr-md text-right font-mono whitespace-nowrap " +
        (strong ? "font-semibold text-on-surface " : "") +
        (muted ? "text-on-surface-variant" : "")
      }
    >
      {children}
    </td>
  );
}

function FlatTable({
  result,
  measure,
  by,
  sortBy,
  onSort,
  onDrill,
}: {
  result: ReturnType<typeof pivot>;
  measure: MeasureKey;
  by: DimKey;
  sortBy: MeasureKey;
  onSort: (m: MeasureKey) => void;
  onDrill: (r: PivotRow) => void;
}) {
  const totalV = measureValue(result.total, measure) ?? 0;
  const additive = !RATIO_MEASURES.includes(measure);
  const all = [...result.rows, ...(result.other ? [result.other] : [])];
  const sortable = !isTimeDim(by) && by !== "closeSpeed";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-md">
        <thead className="text-on-surface-variant">
          <tr>
            <Th>{DIM_LABELS[by]}</Th>
            {MEASURES.map((m) => (
              <Th key={m} right active={m === measure} onClick={sortable ? () => onSort(m) : undefined}>
                {MEASURE_META[m].short}
                {sortable && sortBy === m ? " ↓" : ""}
              </Th>
            ))}
            {additive && <Th right>Share</Th>}
            <Th right>vs prev.</Th>
          </tr>
        </thead>
        <tbody>
          {all.length === 0 && (
            <tr>
              <td colSpan={MEASURES.length + 3} className="py-md text-center text-on-surface-variant">
                No data for this period and filter.
              </td>
            </tr>
          )}
          {all.map((r) => {
            const v = measureValue(r.acc, measure);
            const share = additive && totalV ? ((v ?? 0) / totalV) * 100 : null;
            return (
              <tr
                key={r.key}
                onClick={() => onDrill(r)}
                className={"border-t border-outline-variant/60 " + (r.key === OTHER_KEY ? "" : "cursor-pointer hover:bg-surface-container")}
              >
                <td className="py-sm pr-md font-medium">{r.label}</td>
                {MEASURES.map((m) => (
                  <Num key={m} strong={m === measure} muted={measureValue(r.acc, m) === 0}>
                    {fmt(m, measureValue(r.acc, m))}
                  </Num>
                ))}
                {additive && (
                  <td className="py-sm pr-md text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-xs">
                      <div className="w-16 h-1.5 rounded-full bg-surface-container overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(100, share ?? 0)}%` }} />
                      </div>
                      <span className="font-mono text-on-surface-variant w-12 text-right">{share === null ? "—" : `${share.toFixed(1)}%`}</span>
                    </div>
                  </td>
                )}
                <td className="py-sm pr-md text-right whitespace-nowrap">
                  {isTimeDim(by) ? "—" : <DeltaChip pct={deltaPct(v, measureValue(r.prev, measure))} />}
                </td>
              </tr>
            );
          })}
        </tbody>
        {all.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-outline-variant font-semibold">
              <td className="py-sm pr-md">Total</td>
              {MEASURES.map((m) => (
                <Num key={m} strong>
                  {fmt(m, measureValue(result.total, m))}
                </Num>
              ))}
              {additive && <Num>100%</Num>}
              <td className="py-sm pr-md text-right">
                <DeltaChip pct={deltaPct(measureValue(result.total, measure), measureValue(result.prevTotal, measure))} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function SplitTable({
  result,
  measure,
  by,
  onDrill,
}: {
  result: ReturnType<typeof pivot>;
  measure: MeasureKey;
  by: DimKey;
  onDrill: (r: PivotRow) => void;
}) {
  const all = [...result.rows, ...(result.other ? [result.other] : [])];
  // Heat shading within the grid makes the strongest cells pop.
  const max = Math.max(
    1,
    ...all.flatMap((r) => result.columns.map((c) => (r.cells[c.key] ? (measureValue(r.cells[c.key], measure) ?? 0) : 0))),
  );
  const cell = (a: Acc | undefined) => {
    const v = a ? measureValue(a, measure) : null;
    const alpha = v ? Math.max(0.06, Math.min(0.55, (v / max) * 0.55)) : 0;
    return (
      <td
        className="py-sm pr-md pl-sm text-right font-mono whitespace-nowrap"
        style={{ backgroundColor: alpha ? `rgba(201,160,25,${alpha})` : undefined }}
      >
        {v ? fmt(measure, v) : <span className="text-on-surface-variant">—</span>}
      </td>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-md">
        <thead className="text-on-surface-variant">
          <tr>
            <Th>{DIM_LABELS[by]}</Th>
            {result.columns.map((c) => (
              <Th key={c.key} right>
                {c.label}
              </Th>
            ))}
            <Th right active>
              Total
            </Th>
          </tr>
        </thead>
        <tbody>
          {all.map((r) => (
            <tr
              key={r.key}
              onClick={() => onDrill(r)}
              className={"border-t border-outline-variant/60 " + (r.key === OTHER_KEY ? "" : "cursor-pointer hover:bg-surface-container")}
            >
              <td className="py-sm pr-md font-medium whitespace-nowrap">{r.label}</td>
              {result.columns.map((c) => (
                <Fragment key={c.key}>{cell(r.cells[c.key])}</Fragment>
              ))}
              <Num strong>{fmt(measure, measureValue(r.acc, measure))}</Num>
            </tr>
          ))}
        </tbody>
        {all.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-outline-variant font-semibold">
              <td className="py-sm pr-md">Total</td>
              {result.columns.map((c) => (
                <Num key={c.key} strong>
                  {fmt(measure, measureValue(c.acc, measure))}
                </Num>
              ))}
              <Num strong>{fmt(measure, measureValue(result.total, measure))}</Num>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Leaderboard({
  title,
  measure,
  rows,
  onPick,
}: {
  title: string;
  measure: MeasureKey;
  rows: PivotRow[];
  onPick: () => void;
}) {
  const vals = rows.map((r) => measureValue(r.acc, measure) ?? 0);
  const max = Math.max(1, ...vals);
  return (
    <Section
      title={title}
      action={
        <button type="button" onClick={onPick} className="text-accent text-label-sm font-semibold hover:underline">
          Analyse →
        </button>
      }
    >
      {rows.length === 0 ? (
        <p className="text-on-surface-variant text-body-md">No data.</p>
      ) : (
        <ol className="space-y-sm">
          {rows.map((r, i) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between text-body-md">
                <span className="truncate pr-sm">
                  <span className="text-on-surface-variant font-mono mr-xs">{i + 1}.</span>
                  {r.label}
                </span>
                <span className="font-mono font-semibold">{fmt(measure, vals[i])}</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-container mt-xs overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(vals[i] / max) * 100}%`, backgroundColor: SERIES[0] }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

function downloadCsv(result: ReturnType<typeof pivot>, measure: MeasureKey, by: DimKey, split: DimKey | null) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const num = (v: number | null) => (v === null ? "" : String(Math.round(v * 100) / 100));
  const all = [...result.rows, ...(result.other ? [result.other] : [])];
  const lines: string[] = [];
  if (split) {
    lines.push([DIM_LABELS[by], ...result.columns.map((c) => c.label), "Total"].map(esc).join(","));
    for (const r of all)
      lines.push(
        [esc(r.label), ...result.columns.map((c) => num(r.cells[c.key] ? measureValue(r.cells[c.key], measure) : null)), num(measureValue(r.acc, measure))].join(","),
      );
  } else {
    lines.push([DIM_LABELS[by], ...MEASURES.map((m) => MEASURE_META[m].label)].map(esc).join(","));
    for (const r of all) lines.push([esc(r.label), ...MEASURES.map((m) => num(measureValue(r.acc, m)))].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sales-analysis-${by}${split ? `-x-${split}` : ""}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

