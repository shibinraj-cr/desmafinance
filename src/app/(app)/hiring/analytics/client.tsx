"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import {
  REPORT_DIMENSIONS,
  REPORT_MEASURES,
  DIMENSION_LABELS,
  MEASURE_LABELS,
  type FunnelStep,
  type TimeToHire,
  type StageDwell,
  type OfferOutcome,
  type ReportDimension,
  type ReportMeasure,
} from "@/lib/hiring/analytics";

type SourceRow = { key: string; label: string; applications: number; hires: number; hireRatePct: number | null };
type PartnerRow = {
  id: string; agencyName: string; submitted: number; placed: number;
  fillRatePct: number | null; feesLakh: number; costPerHireLakh: number | null;
};
type ReportResult = {
  dimensionLabel: string;
  measures: string[];
  measureLabels: string[];
  rows: Record<string, string | number | null>[];
};

const TABS = [
  { key: "funnel", label: "Funnel" },
  { key: "sources", label: "Sources" },
  { key: "partners", label: "Partner ROI" },
  { key: "custom", label: "Custom reports" },
];

const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
const primaryBtn =
  "h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60";

export function AnalyticsClient(props: {
  tab: string;
  from: string;
  to: string;
  eventCount: number;
  funnel: FunnelStep[];
  timeToHire: TimeToHire;
  timeInStage: StageDwell[];
  offers: OfferOutcome;
  agingJobs: number;
  sources: SourceRow[];
  partners: PartnerRow[];
  loadedAt: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(props.from);
  const [to, setTo] = useState(props.to);

  function go(tab: string, nextFrom = from, nextTo = to) {
    router.push(`/hiring/analytics?tab=${tab}&from=${nextFrom}&to=${nextTo}`);
  }

  return (
    <div className="space-y-lg">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <nav className="flex flex-wrap gap-xs" aria-label="Analytics views">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => go(t.key)}
              aria-current={props.tab === t.key ? "page" : undefined}
              className={
                "h-8 px-md rounded-full text-label-sm border transition " +
                (props.tab === t.key
                  ? "bg-primary text-on-primary border-primary"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-xs">
          <label className="sr-only" htmlFor="from">From</label>
          <input
            id="from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
          />
          <span className="text-label-sm text-on-surface-variant">to</span>
          <label className="sr-only" htmlFor="to">To</label>
          <input
            id="to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
          />
          <button type="button" className={primaryBtn} onClick={() => go(props.tab, from, to)}>
            Apply
          </button>
          <RefreshBar loadedAt={props.loadedAt} label={`${props.eventCount} events read`} />
        </div>
      </div>

      {props.tab === "funnel" && (
        <div className="space-y-lg">
          <div className="grid gap-md grid-cols-2 lg:grid-cols-4">
            <Kpi label="Time to hire (median)" value={props.timeToHire.medianDays == null ? "—" : `${props.timeToHire.medianDays}d`} hint={`${props.timeToHire.count} hires in range`} />
            <Kpi label="Offers out" value={props.offers.sent} />
            <Kpi label="Offer accept rate" value={props.offers.acceptRatePct == null ? "—" : `${props.offers.acceptRatePct}%`} />
            <Kpi label="Aging reqs" value={props.agingJobs} tone={props.agingJobs > 0 ? "warn" : undefined} />
          </div>

          <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
            <h2 className="text-h3 text-on-surface mb-xs">Funnel</h2>
            <p className="text-caption text-on-surface-variant mb-md">
              How many applications <strong>ever reached</strong> each stage in this range — counted
              from the activity log, so somebody rejected at Offer still counts at Interview.
            </p>
            {props.funnel.every((f) => f.reached === 0) ? (
              <Empty>Nothing moved in this range. Widen the dates, or check a live requisition.</Empty>
            ) : (
              <ol className="space-y-sm">
                {props.funnel.map((step, i) => {
                  const top = props.funnel[0]?.reached ?? 0;
                  const width = top === 0 ? 0 : Math.round((step.reached / top) * 100);
                  return (
                    <li key={step.position}>
                      <div className="flex items-baseline justify-between gap-md text-body-md">
                        <span className="text-on-surface">{step.label}</span>
                        <span className="text-on-surface-variant tabular-nums">
                          {step.reached}
                          {i < props.funnel.length - 1 && step.conversionPct != null && (
                            <span className="ml-sm text-caption">{step.conversionPct}% on</span>
                          )}
                        </span>
                      </div>
                      <div className="mt-xs h-3 rounded-full bg-surface-container overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${width}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
            <h2 className="text-h3 text-on-surface mb-xs">Where the time goes</h2>
            <p className="text-caption text-on-surface-variant mb-md">
              Average days spent in each stage, counted only once somebody left it — a stage
              somebody is still sitting in has no answer yet.
            </p>
            {props.timeInStage.length === 0 ? (
              <Empty>Nobody has moved between stages in this range.</Empty>
            ) : (
              <ul className="space-y-xs">
                {props.timeInStage.map((s) => (
                  <li key={s.label} className="flex items-baseline justify-between gap-md text-body-md">
                    <span className="text-on-surface-variant">
                      {s.label} <span className="text-caption">· {s.count} moves</span>
                    </span>
                    <span className="text-on-surface tabular-nums">{s.averageDays}d</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {props.tab === "sources" && (
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
          {props.sources.length === 0 ? (
            <div className="p-xl">
              <Empty>No applications arrived in this range.</Empty>
            </div>
          ) : (
            <table className="w-full text-body-md">
              <thead className="text-left border-b border-outline-variant bg-surface-container-low">
                <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-lg py-sm">Source</th>
                  <th className="px-md py-sm text-right">Applications</th>
                  <th className="px-md py-sm text-right">Hires</th>
                  <th className="px-md py-sm text-right">Hire rate</th>
                </tr>
              </thead>
              <tbody>
                {props.sources.map((s) => (
                  <tr key={s.key} className="border-b border-outline-variant last:border-0">
                    <td className="px-lg py-sm text-on-surface">{s.label}</td>
                    <td className="px-md py-sm text-right tabular-nums">{s.applications}</td>
                    <td className="px-md py-sm text-right tabular-nums">{s.hires}</td>
                    <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">
                      {s.hireRatePct == null ? "—" : `${s.hireRatePct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {props.tab === "partners" && (
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
          {props.partners.length === 0 ? (
            <div className="p-xl">
              <Empty>No partner submitted anybody in this range.</Empty>
            </div>
          ) : (
            <table className="w-full text-body-md">
              <thead className="text-left border-b border-outline-variant bg-surface-container-low">
                <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-lg py-sm">Agency</th>
                  <th className="px-md py-sm text-right">Submitted</th>
                  <th className="px-md py-sm text-right">Placed</th>
                  <th className="px-md py-sm text-right">Fill rate</th>
                  <th className="px-md py-sm text-right">Fees (₹ lakh)</th>
                  <th className="px-md py-sm text-right">Cost per hire</th>
                </tr>
              </thead>
              <tbody>
                {props.partners.map((p) => (
                  <tr key={p.id} className="border-b border-outline-variant last:border-0">
                    <td className="px-lg py-sm text-on-surface">{p.agencyName}</td>
                    <td className="px-md py-sm text-right tabular-nums">{p.submitted}</td>
                    <td className="px-md py-sm text-right tabular-nums">{p.placed}</td>
                    <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">
                      {p.fillRatePct == null ? "—" : `${p.fillRatePct}%`}
                    </td>
                    <td className="px-md py-sm text-right tabular-nums">{p.feesLakh}</td>
                    <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">
                      {p.costPerHireLakh == null ? "—" : `₹${p.costPerHireLakh}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {props.tab === "custom" && <CustomReport from={from} to={to} />}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md" title={hint}>
      <div className={"text-h1 tabular-nums " + (tone === "warn" ? "text-error" : "text-on-surface")}>{value}</div>
      <div className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-body-sm text-on-surface-variant text-center">{children}</p>;
}

function CustomReport({ from, to }: { from: string; to: string }) {
  const [dimension, setDimension] = useState<ReportDimension>("source");
  const [measures, setMeasures] = useState<ReportMeasure[]>(["applications", "hires"]);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const body = () => ({
    dimension,
    measures,
    from: new Date(`${from}T00:00:00+05:30`).toISOString(),
    to: new Date(`${to}T23:59:59+05:30`).toISOString(),
  });

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/hiring/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body(), format: "json" }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("That report could not be built.");
      return;
    }
    setResult((await res.json()) as ReportResult);
  }

  async function exportCsv() {
    const res = await fetch("/api/hiring/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body(), format: "csv" }),
    });
    if (!res.ok) {
      setError("That export failed.");
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `hiring-report-${dimension}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-lg">
      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
        <h2 className="text-h3 text-on-surface">Build a report</h2>

        {error && (
          <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
            {error}
          </div>
        )}

        <label className="block max-w-xs">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Break down by</span>
          <select
            className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
            value={dimension}
            onChange={(e) => setDimension(e.target.value as ReportDimension)}
          >
            {REPORT_DIMENSIONS.map((d) => (
              <option key={d} value={d}>
                {DIMENSION_LABELS[d]}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="text-label-sm text-on-surface-variant mb-xs">Measure</legend>
          <div className="flex flex-wrap gap-xs">
            {REPORT_MEASURES.map((m) => (
              <label
                key={m}
                className={
                  "inline-flex items-center gap-xs h-9 px-md rounded-full border text-label-sm cursor-pointer transition " +
                  (measures.includes(m)
                    ? "border-primary bg-primary-fixed/40 text-on-surface"
                    : "border-outline-variant text-on-surface-variant")
                }
              >
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={measures.includes(m)}
                  onChange={(e) =>
                    setMeasures((prev) => (e.target.checked ? [...prev, m] : prev.filter((x) => x !== m)))
                  }
                />
                {MEASURE_LABELS[m]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex gap-xs">
          <button type="button" className={primaryBtn} onClick={run} disabled={busy || measures.length === 0}>
            {busy ? "Building…" : "Run report"}
          </button>
          {result && (
            <button type="button" className={btn} onClick={exportCsv}>
              Export CSV
            </button>
          )}
        </div>
      </section>

      {result && (
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
          {result.rows.length === 0 ? (
            <div className="p-xl">
              <Empty>Nothing in that range to break down.</Empty>
            </div>
          ) : (
            <table className="w-full text-body-md">
              <thead className="text-left border-b border-outline-variant bg-surface-container-low">
                <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-lg py-sm">{result.dimensionLabel}</th>
                  {result.measureLabels.map((m) => (
                    <th key={m} className="px-md py-sm text-right">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={String(row.key)} className="border-b border-outline-variant last:border-0">
                    <td className="px-lg py-sm text-on-surface">{String(row.label)}</td>
                    {result.measures.map((m) => (
                      <td key={m} className="px-md py-sm text-right tabular-nums">
                        {row[m] == null ? "—" : String(row[m])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
