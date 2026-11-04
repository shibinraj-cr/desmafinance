"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { KpiCard, Section } from "@/components/Cards";
import { inr, inrCompact } from "@/lib/format";
import type { BdeEnrollmentData, BdeRow, PipelineBucket, ConsultantDetail } from "@/lib/crm-bde-enrollment";
import { cellConversion, type ComparisonCell, type ComparisonMonth, type ComparisonTable } from "@/lib/crm-monthly-comparison";

function convTone(pct: number | null): string {
  if (pct === null) return "text-on-surface-variant";
  if (pct >= 14) return "text-green-700";
  if (pct >= 9) return "text-accent";
  return "text-error";
}

function flagTone(flags: number): { chip: string } {
  if (flags > 24) return { chip: "bg-red-50 text-error" };
  if (flags > 12) return { chip: "bg-amber-50 text-amber-800" };
  return { chip: "bg-green-50 text-green-700" };
}

function tileTone(tone: "danger" | "warning" | "neutral"): { icon: string; bg: string } {
  if (tone === "danger") return { icon: "text-error", bg: "bg-red-50/60" };
  if (tone === "warning") return { icon: "text-amber-600", bg: "bg-amber-50/60" };
  return { icon: "text-on-surface-variant", bg: "bg-surface-container-lowest" };
}

function bucketTone(tone: "danger" | "warning" | "neutral"): { accent: string; head: string } {
  if (tone === "danger") return { accent: "text-error", head: "bg-red-50/60 border-t-error" };
  if (tone === "warning") return { accent: "text-accent", head: "bg-amber-50/60 border-t-accent" };
  return { accent: "text-on-surface", head: "bg-surface-container-low border-t-on-surface" };
}

/** BDE + month filters. Both are searchParams, so changing either does a fresh server fetch. */
function FilterBar({ data }: { data: BdeEnrollmentData }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(search.toString());
    if (value === "all" || value === "") params.delete(key);
    else params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-base">
      <p className="text-label-sm text-on-surface-variant">
        Enrolment &amp; conversion for <span className="font-semibold text-on-surface">{data.monthLabel}</span>. Pipeline
        and SLA buckets are live (now).
      </p>
      <div className="flex flex-wrap items-center gap-sm">
        <select
          value={data.bdeFilter}
          onChange={(e) => setParam("bde", e.target.value)}
          aria-label="BDE filter"
          className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition"
        >
          {data.bdeOptions.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
        <select
          value={data.month}
          onChange={(e) => setParam("month", e.target.value)}
          aria-label="Month filter"
          className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition"
        >
          {data.monthOptions.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function TargetVsActual({ data }: { data: BdeEnrollmentData }) {
  const { team } = data;
  const daysLeft = Math.max(0, data.daysInMonth - data.elapsedDays);
  return (
    <Section
      title="Target vs actual"
      action={
        <span className="text-caption text-on-surface-variant">
          {daysLeft > 0 ? `Day ${data.elapsedDays} of ${data.daysInMonth} · ${daysLeft} days left` : "Month closed"}
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2 items-center">
        <div className="flex flex-col gap-sm">
          <div className="flex items-baseline gap-sm">
            <span className="text-[40px] leading-[44px] font-semibold text-on-surface">{team.enrolled}</span>
            <span className="text-body-md text-on-surface-variant">/ {team.target} enrolments</span>
          </div>
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-outline-variant">
            <div
              className={`h-full rounded-full ${team.ahead ? "bg-green-600" : "bg-error"}`}
              style={{ width: `${team.actualWidthPct}%` }}
            />
            <div className="absolute -top-[3px] -bottom-[3px] w-[2px] bg-on-surface" style={{ left: `${team.paceMarkerPct}%` }} />
          </div>
          <p className="text-caption text-on-surface-variant">{team.paceText}</p>
        </div>
        <div className="grid grid-cols-2 gap-gutter sm:grid-cols-4">
          <div className="border-l-2 border-outline-variant pl-md">
            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">Pace gap</p>
            <p className={`mt-xs text-h3 font-semibold ${team.paceGap >= 0 ? "text-green-700" : "text-error"}`}>
              {team.paceGap >= 0 ? "+" : ""}
              {team.paceGap}
            </p>
            <p className="text-caption text-on-surface-variant">vs {Math.round(team.target * (data.elapsedDays / Math.max(1, data.daysInMonth)))} due to date</p>
          </div>
          <div className="border-l-2 border-outline-variant pl-md">
            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">Projected close</p>
            <p className={`mt-xs text-h3 font-semibold ${team.projected >= team.target ? "text-green-700" : "text-error"}`}>{team.projected}</p>
            <p className="text-caption text-on-surface-variant">at current run-rate</p>
          </div>
          <div className="border-l-2 border-outline-variant pl-md">
            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">Ahead of pace</p>
            <p className="mt-xs text-h3 font-semibold text-on-surface">
              {team.aheadCount} / {team.totalCount}
            </p>
            <p className="text-caption text-on-surface-variant">consultants on track</p>
          </div>
          <div className="border-l-2 border-outline-variant pl-md">
            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">Avg ticket</p>
            <p className="mt-xs text-h3 font-semibold text-on-surface">{team.avgTicket ? inr(team.avgTicket) : "—"}</p>
            <p className="text-caption text-on-surface-variant">per enrolment</p>
          </div>
        </div>
      </div>
    </Section>
  );
}

function BdeTable({ data, onSelect }: { data: BdeEnrollmentData; onSelect: (id: string) => void }) {
  const t = data.totals;
  return (
    <Section
      title="BDE-wise enrolment & conversion"
      action={<span className="text-caption text-on-surface-variant">Click a consultant for the full breakdown · {data.monthLabel}</span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse text-label-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left text-caption uppercase tracking-wider text-on-surface-variant">
              <th className="py-sm pr-sm font-semibold">Consultant</th>
              <th className="px-sm py-sm text-right font-semibold">Given</th>
              <th className="px-sm py-sm text-right font-semibold">Created</th>
              <th className="px-sm py-sm text-right font-semibold">Enrolled</th>
              <th className="px-sm py-sm text-right font-semibold">Conv. / given</th>
              <th className="px-sm py-sm text-right font-semibold">Conv. / created</th>
              <th className="px-sm py-sm text-right font-semibold">Target</th>
              <th className="px-sm py-sm text-right font-semibold">Enrolled value</th>
              <th className="px-sm py-sm text-right font-semibold">Pipeline</th>
              <th className="px-sm py-sm text-right font-semibold">Tasks ✓</th>
              <th className="pl-sm py-sm text-right font-semibold">Flags</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-lg text-center text-on-surface-variant">
                  No active consultants.
                </td>
              </tr>
            ) : (
              data.rows.map((r) => {
                const tone = flagTone(r.flags);
                const paceWidth = Math.min(100, Math.round((r.enrolled / Math.max(1, r.target)) * 100));
                return (
                  <tr
                    key={r.userId}
                    onClick={() => onSelect(r.userId)}
                    className="cursor-pointer border-b border-outline-variant/60 hover:bg-surface-container-low"
                  >
                    <td className="py-sm pr-sm">
                      <span className="font-medium text-on-surface">{r.name}</span>
                      <span className="ml-xs text-caption uppercase text-on-surface-variant">{r.role}</span>
                    </td>
                    <td className="px-sm py-sm text-right tabular-nums">{r.assigned}</td>
                    <td className="px-sm py-sm text-right tabular-nums">{r.created}</td>
                    <td className="px-sm py-sm text-right font-semibold tabular-nums">{r.enrolled}</td>
                    <td className={`px-sm py-sm text-right font-semibold tabular-nums ${convTone(r.convAssigned)}`}>
                      {r.convAssigned === null ? "—" : `${r.convAssigned}%`}
                    </td>
                    <td className="px-sm py-sm text-right tabular-nums text-on-surface-variant">
                      {r.convCreated === null ? "—" : `${r.convCreated}%`}
                    </td>
                    <td className="px-sm py-sm text-right">
                      <div className="flex items-center justify-end gap-sm">
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-outline-variant">
                          <div className={`h-full rounded-full ${r.ahead ? "bg-green-600" : "bg-error"}`} style={{ width: `${paceWidth}%` }} />
                        </div>
                        <span className="text-caption tabular-nums text-on-surface-variant">
                          {r.enrolled}/{r.target}
                        </span>
                      </div>
                    </td>
                    <td className="px-sm py-sm text-right tabular-nums">{inr(r.enrolledValue)}</td>
                    <td className="px-sm py-sm text-right tabular-nums text-on-surface-variant">{inr(r.pipelineValue)}</td>
                    <td className="px-sm py-sm text-right tabular-nums">
                      {r.tasksCompleted}
                      <span className="ml-xs rounded-full bg-surface-container-low px-xs py-[1px] text-[11px] font-semibold text-on-surface-variant">
                        {r.tasksCompleted ? `${Math.round((r.tasksOnTime / r.tasksCompleted) * 100)}%` : "—"}
                      </span>
                    </td>
                    <td className="pl-sm py-sm text-right">
                      <span className={`inline-flex items-center rounded-full px-sm py-[1px] text-[11px] font-semibold ${tone.chip}`}>
                        {r.flags}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {data.rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-outline-variant font-semibold">
                <td className="py-sm pr-sm">Team total</td>
                <td className="px-sm py-sm text-right tabular-nums">{t.assigned}</td>
                <td className="px-sm py-sm text-right tabular-nums">{t.created}</td>
                <td className="px-sm py-sm text-right tabular-nums">{t.enrolled}</td>
                <td className="px-sm py-sm text-right tabular-nums text-accent">{t.convAssigned === null ? "—" : `${t.convAssigned}%`}</td>
                <td className="px-sm py-sm text-right tabular-nums text-on-surface-variant">{t.convCreated === null ? "—" : `${t.convCreated}%`}</td>
                <td className="px-sm py-sm text-right tabular-nums text-on-surface-variant">
                  {t.enrolled}/{t.target}
                </td>
                <td className="px-sm py-sm text-right tabular-nums">{inr(t.enrolledValue)}</td>
                <td className="px-sm py-sm text-right tabular-nums text-on-surface-variant">{inr(t.pipelineValue)}</td>
                <td className="px-sm py-sm text-right tabular-nums">
                  {t.tasksCompleted}
                  <span className="ml-xs text-caption text-on-surface-variant">
                    {t.tasksCompleted ? `${Math.round((t.tasksOnTime / t.tasksCompleted) * 100)}%` : "—"}
                  </span>
                </td>
                <td className="pl-sm py-sm text-right text-error">{t.flags}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Section>
  );
}

type Measure = "enrolled" | "value" | "leads" | "conv";

const MEASURES: Array<{ key: Measure; label: string }> = [
  { key: "enrolled", label: "Enrolments" },
  { key: "value", label: "Value" },
  { key: "leads", label: "Leads given" },
  { key: "conv", label: "Conv. %" },
];

// One hue, more is darker — relative to the largest month cell in the table.
const HEAT_STEPS = ["bg-primary/10", "bg-primary/20", "bg-primary/30", "bg-primary/50"];

function measureOf(c: ComparisonCell, m: Measure): number | null {
  return m === "conv" ? cellConversion(c) : c[m];
}

function fmtMeasure(v: number | null, m: Measure): string {
  if (v === null) return "—";
  if (m === "value") return inrCompact(v);
  if (m === "conv") return `${v}%`;
  return String(v);
}

function heatClass(v: number | null, max: number): string {
  if (!v || max <= 0) return "";
  return HEAT_STEPS[Math.min(HEAT_STEPS.length - 1, Math.ceil((v / max) * HEAT_STEPS.length) - 1)];
}

function cellTitle(month: ComparisonMonth, c: ComparisonCell): string {
  const conv = cellConversion(c);
  return (
    `${month.label}${month.partial ? " (to date)" : ""} · ${c.enrolled} enrolled · ${inr(c.value)} · ` +
    `${c.leads} leads given · ${conv === null ? "—" : `${conv}%`} conv.`
  );
}

const STICKY = "sticky left-0 z-[1] bg-surface-container-lowest";

function ComparisonGrid({
  label,
  table,
  months,
  measure,
  onSelect,
}: {
  label: string;
  table: ComparisonTable;
  months: ComparisonMonth[];
  measure: Measure;
  onSelect: (id: string) => void;
}) {
  const max = Math.max(0, ...table.rows.flatMap((r) => r.cells.map((c) => measureOf(c, measure) ?? 0)));
  return (
    <div className="overflow-x-auto">
      {/* Fixed layout so the BDE and source tables' month columns line up; the name column stays put while months scroll. */}
      <table className="w-full min-w-[680px] table-fixed border-collapse text-label-sm">
        <colgroup>
          <col className="w-[132px] sm:w-[220px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-outline-variant text-left text-caption uppercase tracking-wider text-on-surface-variant">
            <th className={`${STICKY} py-sm pr-sm font-semibold`}>{label}</th>
            {months.map((m) => (
              <th key={m.value} className="px-sm py-sm text-right font-semibold">
                {m.short}
                {m.partial && <span className="block text-[10px] font-normal normal-case tracking-normal">to date</span>}
              </th>
            ))}
            <th className="pl-sm py-sm text-right font-semibold">{measure === "conv" ? "Overall" : "Total"}</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.length === 0 ? (
            <tr>
              <td colSpan={months.length + 2} className="py-lg text-center text-on-surface-variant">
                No leads or enrolments in these months.
              </td>
            </tr>
          ) : (
            table.rows.map((r) => {
              const values = r.cells.map((c) => measureOf(c, measure));
              const best = Math.max(0, ...values.map((v) => v ?? 0));
              return (
                <tr
                  key={r.id}
                  onClick={r.clickable ? () => onSelect(r.id) : undefined}
                  className={`border-b border-outline-variant/60 ${r.clickable ? "cursor-pointer hover:bg-surface-container-low" : ""}`}
                >
                  <td className={`${STICKY} py-sm pr-sm`}>
                    <span className="font-medium text-on-surface">{r.name}</span>
                    {r.note && <span className="ml-xs text-caption uppercase text-on-surface-variant">{r.note}</span>}
                  </td>
                  {r.cells.map((c, i) => (
                    <td
                      key={months[i].value}
                      title={cellTitle(months[i], c)}
                      className={`px-sm py-sm text-right tabular-nums ${heatClass(values[i], max)} ${
                        values[i] && values[i] === best ? "font-semibold text-on-surface" : "text-on-surface-variant"
                      }`}
                    >
                      {fmtMeasure(values[i], measure)}
                    </td>
                  ))}
                  <td className="pl-sm py-sm text-right font-semibold tabular-nums">{fmtMeasure(measureOf(r.total, measure), measure)}</td>
                </tr>
              );
            })
          )}
        </tbody>
        {table.rows.length > 1 && (
          <tfoot>
            <tr className="border-t-2 border-outline-variant font-semibold">
              <td className={`${STICKY} py-sm pr-sm`}>Team total</td>
              {table.totals.map((c, i) => (
                <td key={months[i].value} title={cellTitle(months[i], c)} className="px-sm py-sm text-right tabular-nums">
                  {fmtMeasure(measureOf(c, measure), measure)}
                </td>
              ))}
              <td className="pl-sm py-sm text-right tabular-nums">{fmtMeasure(measureOf(table.grandTotal, measure), measure)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function MonthlyComparisonSection({ data, onSelect }: { data: BdeEnrollmentData; onSelect: (id: string) => void }) {
  const [measure, setMeasure] = useState<Measure>("enrolled");
  const { months, byBde, bySource } = data.comparison;
  return (
    <Section title="Monthly comparison">
      {/* The measure toggle sits in the body, not the Section header, so it can wrap at phone width. */}
      <div className="-mt-sm mb-md flex flex-wrap items-start justify-between gap-sm">
        <p className="max-w-3xl text-caption text-on-surface-variant">
          {months[0]?.label} – {months[months.length - 1]?.label}. Enrolments and value count by close month, leads by
          month given — the same rules as this month&apos;s figures on the rest of the page. Bold is each row&apos;s best
          month; darker means higher. Hover a month for all four figures.
        </p>
        <div className="inline-flex flex-wrap rounded-lg border border-outline-variant bg-surface-container-low p-[2px]" role="group" aria-label="Measure">
          {MEASURES.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={measure === m.key}
              onClick={() => setMeasure(m.key)}
              className={`rounded-md px-md py-xs text-label-sm font-semibold transition ${
                measure === m.key ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-lg">
        <div>
          <p className="mb-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">By BDE</p>
          <ComparisonGrid label="Consultant" table={byBde} months={months} measure={measure} onSelect={onSelect} />
        </div>
        <div>
          <p className="mb-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">By source</p>
          <ComparisonGrid label="Source" table={bySource} months={months} measure={measure} onSelect={onSelect} />
        </div>
      </div>
    </Section>
  );
}

function BucketCard({ bucket }: { bucket: PipelineBucket }) {
  const tone = bucketTone(bucket.tone);
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
      <div className={`border-t-[3px] px-md py-md ${tone.head}`}>
        <p className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">{bucket.label}</p>
        <div className="mt-xs flex items-baseline gap-sm">
          <span className={`text-h3 font-semibold ${tone.accent}`}>{inr(bucket.value)}</span>
          <span className="text-caption text-on-surface-variant">
            {bucket.count} deal{bucket.count === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <ul className="flex flex-col px-md pb-md pt-sm">
        {bucket.deals.length === 0 ? (
          <li className="py-sm text-center text-caption text-on-surface-variant">No deals</li>
        ) : (
          bucket.deals.map((d) => (
            <li key={d.id} className="flex items-center gap-sm border-b border-outline-variant/60 py-sm last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-label-sm text-on-surface">{d.name}</p>
                <p className="truncate text-caption text-on-surface-variant">{d.meta}</p>
              </div>
              <span className="text-label-sm font-semibold tabular-nums text-on-surface">{inr(d.value)}</span>
            </li>
          ))
        )}
        <li className="pt-sm text-caption text-on-surface-variant">{bucket.moreCount > 0 ? `+ ${bucket.moreCount} more` : bucket.deals.length > 0 ? "All shown" : ""}</li>
      </ul>
    </div>
  );
}

/** `/crm/team/queue` href for one SLA tile — carries the current BDE filter as the consultant param. */
function queueHref(issue: string, bdeFilter: string): string {
  const params = new URLSearchParams({ issue });
  if (bdeFilter !== "all") params.set("consultant", bdeFilter);
  return `/crm/team/queue?${params.toString()}`;
}

function SlaAndSources({ data, onSelect }: { data: BdeEnrollmentData; onSelect: (id: string) => void }) {
  return (
    <section className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
      <Section
        title="SLA & follow-up health"
        action={<span className="text-caption text-on-surface-variant">Live · all owners · click a box to reassign</span>}
      >
        <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
          {data.slaTiles.map((s) => {
            const tone = tileTone(s.tone);
            return (
              <Link
                key={s.key}
                href={queueHref(s.issue, data.bdeFilter)}
                className={`flex items-center gap-sm rounded-lg border border-outline-variant px-md py-sm transition hover:border-primary/50 ${tone.bg}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-label-sm text-on-surface-variant">{s.label}</p>
                  <p className="text-caption text-on-surface-variant">{s.rule}</p>
                </div>
                <span className={`text-h3 font-semibold tabular-nums ${tone.icon}`}>{s.count}</span>
              </Link>
            );
          })}
        </div>
        <p className="mb-sm mt-lg text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">Where the pressure sits</p>
        {data.slaWorst.length === 0 ? (
          <p className="py-md text-center text-label-sm text-on-surface-variant">Nothing here — all clear.</p>
        ) : (
          <ul className="flex flex-col">
            {data.slaWorst.map((w) => (
              <li
                key={w.userId}
                onClick={() => onSelect(w.userId)}
                className="flex cursor-pointer items-center gap-sm border-b border-outline-variant/60 py-sm last:border-b-0"
              >
                <span className="min-w-0 flex-1 text-label-sm text-on-surface">{w.name}</span>
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-outline-variant">
                  <div className="h-full rounded-full bg-error" style={{ width: `${w.widthPct}%` }} />
                </div>
                <span className="w-8 text-right text-label-sm font-semibold tabular-nums text-error">{w.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Source-wise conversion" action={<span className="text-caption text-on-surface-variant">{data.monthLabel}</span>}>
        {data.sources.length === 0 ? (
          <p className="py-md text-center text-label-sm text-on-surface-variant">No source-attributed leads yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-label-sm">
              <thead>
                <tr className="border-b border-outline-variant text-left text-caption uppercase tracking-wider text-on-surface-variant">
                  <th className="py-sm pr-sm font-semibold">Source</th>
                  <th className="px-sm py-sm text-right font-semibold">Leads</th>
                  <th className="px-sm py-sm text-right font-semibold">Enrolled</th>
                  <th className="px-sm py-sm text-right font-semibold">Conv.</th>
                  <th className="pl-sm py-sm text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.sourceId} className="border-b border-outline-variant/60">
                    <td className="py-sm pr-sm">{s.name}</td>
                    <td className="px-sm py-sm text-right tabular-nums text-on-surface-variant">{s.leads}</td>
                    <td className="px-sm py-sm text-right tabular-nums">{s.enrolled}</td>
                    <td className="px-sm py-sm text-right tabular-nums font-semibold">{s.convPct === null ? "—" : `${s.convPct}%`}</td>
                    <td className="pl-sm py-sm text-right tabular-nums">{inr(s.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </section>
  );
}

function DetailDrawer({ detail, monthLabel, onClose }: { detail: ConsultantDetail; monthLabel: string; onClose: () => void }) {
  const r = detail.row;
  const kpis: Array<{ label: string; value: string; hint: string }> = [
    { label: "Leads given", value: String(r.assigned), hint: `assigned in ${monthLabel}` },
    { label: "Enrolled", value: String(r.enrolled), hint: `target ${r.target}` },
    { label: "Conversion", value: r.convAssigned === null ? "—" : `${r.convAssigned}%`, hint: "of leads given" },
    { label: "Enrolled value", value: inr(r.enrolledValue), hint: r.enrolled ? `avg ${inr(r.enrolledValue / r.enrolled)}` : "—" },
    { label: "Open pipeline", value: inr(r.pipelineValue), hint: `${r.pipelineCount} deals` },
    { label: "Tasks on time", value: r.tasksCompleted ? `${Math.round((r.tasksOnTime / r.tasksCompleted) * 100)}%` : "—", hint: `${r.tasksCompleted} completed` },
  ];
  const slaItems: Array<{ label: string; count: number; icon: string }> = [
    { label: "Stage SLA breaches", count: r.slaBreaches, icon: "timer_off" },
    { label: "First-response gaps (>24h)", count: r.firstResponseBreached, icon: "call_missed" },
    { label: "Abandoned (>30d untouched)", count: r.abandoned, icon: "person_off" },
    { label: "Stuck in stage (>14d)", count: r.stuck, icon: "pause_circle" },
    { label: "No next step", count: r.noTask, icon: "event_busy" },
    { label: "Overdue tasks", count: r.overdueTasks, icon: "assignment_late" },
    { label: "Re-inquiry follow-ups", count: r.openReinquiry, icon: "replay" },
  ];
  const maxStage = Math.max(1, ...detail.stageMix.map((s) => s.count), r.enrolled);

  return (
    <div onClick={onClose} className="fixed inset-0 z-[100] bg-black/40">
      <aside
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 flex h-full w-[480px] max-w-[92vw] flex-col overflow-y-auto bg-surface-container-low shadow-2xl"
      >
        <div className="flex items-start justify-between gap-base bg-brand px-lg pb-md pt-lg text-on-brand">
          <div className="min-w-0">
            <p className="text-caption uppercase tracking-wider text-on-brand-variant">
              {detail.role.toUpperCase()} consultant · {monthLabel}
            </p>
            <h3 className="mt-xs text-h2 font-semibold">{detail.name}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-xs text-on-brand-variant hover:bg-white/10 hover:text-on-brand"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-lg p-lg">
          <div className="grid grid-cols-2 gap-sm">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm">
                <p className="text-[11px] uppercase tracking-wider text-on-surface-variant">{k.label}</p>
                <p className="mt-[2px] text-h3 font-semibold text-on-surface">{k.value}</p>
                <p className="text-[11px] text-on-surface-variant">{k.hint}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
            <p className="mb-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">Current pipeline mix</p>
            {detail.stageMix.map((s) => (
              <div key={s.code} className="flex items-center gap-sm py-[5px]">
                <span className="w-28 shrink-0 text-caption text-on-surface-variant">{s.label}</span>
                <div className="h-3.5 flex-1 overflow-hidden rounded bg-surface-container-low">
                  <div className="h-full rounded" style={{ width: `${Math.round((s.count / maxStage) * 100)}%`, background: s.color ?? "#7E6510" }} />
                </div>
                <span className="w-8 text-right text-caption font-semibold tabular-nums">{s.count}</span>
              </div>
            ))}
            <div className="flex items-center gap-sm py-[5px]">
              <span className="w-28 shrink-0 text-caption text-on-surface-variant">Enrolled ({monthLabel.split(" ")[0]})</span>
              <div className="h-3.5 flex-1 overflow-hidden rounded bg-surface-container-low">
                <div className="h-full rounded bg-green-600" style={{ width: `${Math.round((r.enrolled / maxStage) * 100)}%` }} />
              </div>
              <span className="w-8 text-right text-caption font-semibold tabular-nums">{r.enrolled}</span>
            </div>
          </div>

          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
            <p className="mb-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">Open deals by expected close</p>
            {detail.deals.length === 0 ? (
              <p className="py-sm text-center text-label-sm text-on-surface-variant">No open deals.</p>
            ) : (
              <ul>
                {detail.deals.map((d) => (
                  <li key={d.id} className="flex items-center gap-sm border-b border-outline-variant/60 py-sm last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-label-sm text-on-surface">{d.name}</p>
                      <p className="truncate text-caption text-on-surface-variant">{d.meta}</p>
                    </div>
                    <span className="text-label-sm font-semibold tabular-nums">{inr(d.value)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-sm text-caption text-on-surface-variant">
              {detail.dealsMoreCount > 0 ? `${detail.dealsMoreCount} more open deals · ${inr(r.pipelineValue)} total` : "All open deals shown"}
            </p>
          </div>

          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
            <p className="mb-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">SLA &amp; hygiene</p>
            <ul>
              {slaItems.map((s) => (
                <li key={s.label} className="flex items-center gap-sm border-b border-outline-variant/60 py-xs last:border-b-0">
                  <span className={`material-symbols-outlined text-[18px] ${s.count ? "text-error" : "text-on-surface-variant"}`}>{s.icon}</span>
                  <span className="min-w-0 flex-1 text-label-sm text-on-surface-variant">{s.label}</span>
                  <span className={`text-label-sm font-semibold tabular-nums ${s.count ? "text-error" : "text-on-surface"}`}>{s.count}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
            <p className="mb-xs text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">Read-out</p>
            <p className="text-label-sm text-on-surface-variant">{detail.narrative}</p>
          </div>

          <Link href={`/crm/leads?assignee=${detail.userId}`} className="text-label-sm font-semibold text-primary hover:underline">
            View {detail.name.split(" ")[0]}&apos;s leads →
          </Link>
        </div>
      </aside>
    </div>
  );
}

export function BdeEnrollmentClient({ data }: { data: BdeEnrollmentData }) {
  const [selected, setSelected] = useState<string | null>(null);
  const detail = selected ? data.details[selected] : null;

  // Escape closes the drawer.
  useEffect(() => {
    if (!selected) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <div className="space-y-lg">
      <FilterBar data={data} />

      <section className="grid grid-cols-2 gap-gutter md:grid-cols-3 lg:grid-cols-6">
        {data.kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} hint={k.hint} tone={k.tone} />
        ))}
      </section>

      <TargetVsActual data={data} />
      <BdeTable data={data} onSelect={setSelected} />
      <MonthlyComparisonSection data={data} onSelect={setSelected} />

      <Section title="Pipeline by expected close" action={<span className="text-caption text-on-surface-variant">Open deals only · {data.pipelineNote}</span>}>
        <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-4">
          {data.buckets.map((b) => (
            <BucketCard key={b.key} bucket={b} />
          ))}
        </div>
      </Section>

      <SlaAndSources data={data} onSelect={setSelected} />

      {detail && <DetailDrawer detail={detail} monthLabel={data.monthLabel} onClose={() => setSelected(null)} />}
    </div>
  );
}
