"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Section } from "@/components/Cards";
import { MultiSelect } from "@/components/MultiSelect";
import { DIM_LABELS, bucketLabel, dayFromYmd, decodeFact, type DimKey, type Filters } from "@/lib/sales-analysis";
import type { SalesAnalysisPayload } from "@/lib/sales-analysis-data";
import {
  LEAD_QUALITIES,
  QUALITY_DUE_AFTER_DAYS,
  QUALITY_UNRATED_COLOR,
  type LeadQualityRating,
  type QualityBucket,
} from "@/lib/crm-lead-quality";
import {
  MIN_RATED_FOR_SIGNAL,
  RATING_BIAS_MIN_RATED,
  RATING_BIAS_POINTS,
  badShare,
  enrolRate,
  leadDimOptions,
  qualityByGroup,
  qualityTotals,
  ratedCount,
  ratedOnTimeShare,
  ratingBias,
  ratingShare,
  reasonBreakdown,
  type QualityCounts,
  type QualityGroupRow,
} from "@/lib/lead-quality-report";
import { PeriodBar, type Range } from "./client";

/** The cuts the mix chart offers; each is a dimension the lead facts carry. */
const GROUP_DIMS: DimKey[] = ["source", "campaign", "adSet", "service", "bde", "originalSource", "country", "month", "week"];
/** Dimensions the page can be filtered by. */
const FILTER_DIMS: DimKey[] = ["source", "campaign", "service", "bde"];
/** Dimensions a row can open in the CRM leads list, and the list's query key for each. */
const LEADS_PARAM: Partial<Record<DimKey, string>> = { source: "source", service: "service", bde: "assignee", campaign: "campaign" };

const pct = (v: number | null, digits = 0) => (v === null ? "—" : `${v.toFixed(digits)}%`);
const n = (v: number) => v.toLocaleString("en-IN");

function isGroupDim(v: string | null): v is DimKey {
  return !!v && (GROUP_DIMS as string[]).includes(v);
}

export function LeadQualityView({ payload, range }: { payload: SalesAnalysisPayload; range: Range }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const facts = useMemo(() => payload.facts.map(decodeFact), [payload.facts]);
  const dicts = payload.dicts;
  const cur = useMemo(() => ({ from: dayFromYmd(range.from), to: dayFromYmd(range.to) }), [range.from, range.to]);

  const [by, setBy] = useState<DimKey>(() => (isGroupDim(search.get("qby")) ? (search.get("qby") as DimKey) : "source"));
  const [filters, setFilters] = useState<Filters>(() => {
    const out: Filters = {};
    for (const d of FILTER_DIMS) {
      const v = search.getAll(`f_${d}`);
      if (v.length) out[d] = v;
    }
    return out;
  });
  const [hideThin, setHideThin] = useState(false);

  // Mirror the cut into the URL so a view can be shared, keeping the period.
  useEffect(() => {
    const p = new URLSearchParams();
    for (const k of ["period", "from", "to"]) {
      const v = search.get(k);
      if (v) p.set(k, v);
    }
    p.set("view", "quality");
    p.set("qby", by);
    for (const [d, keys] of Object.entries(filters)) for (const k of keys ?? []) p.append(`f_${d}`, k);
    window.history.replaceState(null, "", `${pathname}?${p.toString()}`);
  }, [by, filters, pathname, search]);

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

  const totals = useMemo(() => qualityTotals(facts, dicts, { range: cur, filters }), [facts, dicts, cur, filters]);
  const groups = useMemo(() => qualityByGroup(facts, dicts, { range: cur, filters, dim: by }), [facts, dicts, cur, filters, by]);
  const reasons = useMemo(() => reasonBreakdown(facts, dicts, { range: cur, filters }), [facts, dicts, cur, filters]);
  const bdes = useMemo(
    () => qualityByGroup(facts, dicts, { range: cur, filters, dim: "bde" }).filter((r) => r.counts.leads > 0),
    [facts, dicts, cur, filters],
  );
  const shown = hideThin ? groups.filter((g) => ratedCount(g.counts) >= MIN_RATED_FOR_SIGNAL) : groups;
  const rated = ratedCount(totals);

  /** CRM leads-list link for the current period + filters, narrowed by `extra`. */
  const leadsHref = (extra: Array<[DimKey, string]>, quality?: QualityBucket): string | null => {
    const p = new URLSearchParams({ period: "custom", from: range.from, to: range.to });
    const pairs: Array<[DimKey, string]> = [
      ...(Object.entries(filters) as Array<[DimKey, string[]]>).flatMap(([d, keys]) => keys.map((k) => [d, k] as [DimKey, string])),
      ...extra,
    ];
    for (const [dim, key] of pairs) {
      const param = LEADS_PARAM[dim];
      if (!param) return null;
      const label = bucketLabel(key, dim, dicts);
      const id = dim === "campaign" ? (dicts.campaign[Number(key)] ?? null) : (payload.leadLinks[dim as "source" | "service" | "bde"]?.[label] ?? null);
      if (!id || label === "Not set" || label === "Not applicable" || label === "Unassigned") return null;
      p.append(param, id);
    }
    if (!pairs.some(([d]) => d === "bde")) p.set("assignee", "all");
    if (quality) p.set("quality", quality);
    return `/crm/leads?${p.toString()}`;
  };

  const exempt = totals.byBucket.exempt;

  return (
    <div className="p-margin space-y-lg">
      <PeriodBar range={range} onChange={setPeriod} />

      <div className="flex flex-wrap items-center gap-sm">
        {FILTER_DIMS.map((d) => (
          <div key={d} className="flex items-center gap-xs">
            <span className="text-label-sm text-on-surface-variant">{DIM_LABELS[d]}</span>
            <MultiSelect
              options={leadDimOptions(facts, d, dicts).map((o) => ({ value: o.value, label: o.label, hint: String(o.count) }))}
              selected={filters[d] ?? []}
              onChange={(next) => setFilters((f) => ({ ...f, [d]: next }))}
              placeholder="All"
              searchable
            />
          </div>
        ))}
        {Object.values(filters).some((v) => v && v.length) && (
          <button type="button" onClick={() => setFilters({})} className="text-label-sm text-accent font-semibold hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {/* Headline numbers. Rating shares are of RATED leads. */}
      <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-gutter">
        <Tile label="Leads created" value={n(totals.leads)} hint="Duplicates excluded" />
        <Tile
          label="Rated on time"
          value={pct(ratedOnTimeShare(totals))}
          hint={`${n(rated)} rated of ${n(rated + totals.byBucket.overdue)} due`}
        />
        <Tile
          label="Overdue ratings"
          value={n(totals.byBucket.overdue)}
          hint={`Unrated ${QUALITY_DUE_AFTER_DAYS}+ days`}
          danger={totals.byBucket.overdue > 0}
          href={totals.byBucket.overdue > 0 ? leadsHref([], "overdue") : null}
        />
        {LEAD_QUALITIES.map((q) => (
          <Tile
            key={q.value}
            label={q.label}
            dot={q.color}
            value={pct(ratingShare(totals, q.value))}
            hint={`${n(totals.byBucket[q.value])} of ${n(rated)} rated`}
            href={totals.byBucket[q.value] > 0 ? leadsHref([], q.value) : null}
          />
        ))}
      </section>

      {exempt > 0 && (
        <p className="text-caption text-on-surface-variant">
          {n(exempt)} of these leads were never due a rating: created before quality rating began, re-enrollments, unassigned, or
          flagged duplicate. They count in &ldquo;Leads created&rdquo; and nowhere else.
        </p>
      )}

      <Section
        title={`Quality mix by ${DIM_LABELS[by].toLowerCase()}`}
        action={
          <div className="flex flex-wrap items-center gap-sm">
            <label className="inline-flex items-center gap-xs text-label-sm text-on-surface-variant">
              <input type="checkbox" checked={hideThin} onChange={(e) => setHideThin(e.target.checked)} />
              Hide rows under {MIN_RATED_FOR_SIGNAL} rated
            </label>
            <select
              value={by}
              aria-label="Group by"
              onChange={(e) => setBy(e.target.value as DimKey)}
              className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold outline-none"
            >
              {GROUP_DIMS.map((d) => (
                <option key={d} value={d}>
                  By {DIM_LABELS[d].toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <MixChart rows={shown} />
        <MixTable rows={shown} by={by} totals={totals} leadsHref={leadsHref} />
      </Section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
        <Section title="Why leads were rated Poor or Junk">
          <ReasonList rows={reasons} />
        </Section>
        <Section title="Do the ratings hold up?">
          <HoldUp totals={totals} />
        </Section>
      </section>

      <Section title="How each BDE rates">
        <BdeTable rows={bdes} team={totals} leadsHref={leadsHref} />
      </Section>

      <p className="text-caption text-on-surface-variant">
        Leads are CRM leads created in the period, duplicates excluded, with their current rating. A lead becomes due for a
        rating {QUALITY_DUE_AFTER_DAYS} days after it enters the system, and closing it asks for one sooner. Shares of Good /
        Average / Poor / Junk are out of rated leads only, so a source isn&apos;t flattered or punished by ratings that
        haven&apos;t been done yet. Enrolled counts the period&apos;s leads that have since enrolled.
      </p>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  hint,
  dot,
  danger,
  href,
}: {
  label: string;
  value: string;
  hint: string;
  dot?: string;
  danger?: boolean;
  href?: string | null;
}) {
  const body = (
    <>
      <p className="text-label-sm uppercase tracking-wider text-on-surface-variant inline-flex items-center gap-xs">
        {dot && <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dot }} />}
        {label}
      </p>
      <p className={"text-h2 mt-xs font-mono " + (danger ? "text-error" : "text-on-surface")}>{value}</p>
      <p className="text-caption text-on-surface-variant mt-xs">{hint}</p>
    </>
  );
  const cls = "block p-md rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm";
  return href ? (
    <Link href={href} className={cls + " hover:border-primary transition"} title="Open these leads in the CRM">
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Phone width: the row labels need a narrower column or the bars get no room at all. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

/** 100%-stacked bar per row: the rated mix only, so every bar reads on the same 0–100 scale. */
function MixChart({ rows }: { rows: QualityGroupRow[] }) {
  const narrow = useNarrow();
  const top = rows.filter((r) => ratedCount(r.counts) > 0).slice(0, 15);
  if (top.length === 0) {
    return <div className="py-xl text-center text-on-surface-variant">No rated leads for this period and filter yet.</div>;
  }
  const data = top.map((r) => {
    const rated = ratedCount(r.counts);
    const point: Record<string, string | number> = { name: r.label, rated };
    for (const q of LEAD_QUALITIES) {
      point[q.value] = (r.counts.byBucket[q.value] / rated) * 100;
      point[`${q.value}_n`] = r.counts.byBucket[q.value];
    }
    return point;
  });
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, top.length * 34 + 70)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: narrow ? 8 : 16, left: narrow ? 0 : 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e2e9" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: narrow ? 11 : 12 }}
          width={narrow ? 92 : 170}
          interval={0}
          tickFormatter={(v: string) => (narrow && v.length > 13 ? `${v.slice(0, 12)}…` : v)}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          formatter={(v: number, name: string, item: { payload?: Record<string, number> }) => {
            const q = LEAD_QUALITIES.find((x) => x.label === name);
            const count = q ? item.payload?.[`${q.value}_n`] : undefined;
            return [`${v.toFixed(0)}%${count !== undefined ? ` (${count})` : ""}`, name];
          }}
          labelFormatter={(label: string, items: Array<{ payload?: Record<string, number> }>) =>
            `${label} · ${items?.[0]?.payload?.rated ?? 0} rated`
          }
        />
        {/* Legend text stays in ink: the pale steps would be unreadable as text. */}
        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => <span className="text-on-surface">{v}</span>} />
        {LEAD_QUALITIES.map((q) => (
          <Bar key={q.value} dataKey={q.value} name={q.label} stackId="mix" fill={q.color} stroke="#ffffff" strokeWidth={2} maxBarSize={26}>
            <LabelList
              dataKey={q.value}
              position="center"
              fill={q.ink}
              fontSize={11}
              formatter={(v: number) => (v >= 12 ? `${Math.round(v)}%` : "")}
            />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function Th({ children, right, title }: { children: React.ReactNode; right?: boolean; title?: string }) {
  return (
    <th title={title} className={"py-sm pr-md text-label-sm uppercase whitespace-nowrap " + (right ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

function CountCell({ value, href }: { value: number; href: string | null }) {
  return (
    <td className={"py-sm pr-md text-right font-mono whitespace-nowrap " + (value === 0 ? "text-on-surface-variant" : "")}>
      {value > 0 && href ? (
        <Link href={href} className="hover:underline hover:text-primary">
          {n(value)}
        </Link>
      ) : (
        n(value)
      )}
    </td>
  );
}

function MixTable({
  rows,
  by,
  totals,
  leadsHref,
}: {
  rows: QualityGroupRow[];
  by: DimKey;
  totals: QualityCounts;
  leadsHref: (extra: Array<[DimKey, string]>, quality?: QualityBucket) => string | null;
}) {
  const linkable = !!LEADS_PARAM[by];
  const all: Array<QualityGroupRow & { total?: boolean }> = [...rows, { key: "__total__", label: "Total", counts: totals, total: true }];
  return (
    <div className="overflow-x-auto mt-md">
      <table className="w-full text-body-md">
        <thead className="text-on-surface-variant">
          <tr>
            <Th>{DIM_LABELS[by]}</Th>
            <Th right>Leads</Th>
            <Th right>Rated</Th>
            {LEAD_QUALITIES.map((q) => (
              <Th key={q.value} right>
                <span className="inline-flex items-center gap-xs">
                  <span aria-hidden className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: q.color }} />
                  {q.label}
                </span>
              </Th>
            ))}
            <Th right title={`Unrated ${QUALITY_DUE_AFTER_DAYS}+ days after entering the system`}>Overdue</Th>
            <Th right title="Poor + Junk, as a share of rated leads">Bad %</Th>
            <Th right title="Leads from this period that have since enrolled">Enrolled</Th>
            <Th right>Conv.</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={11} className="py-md text-center text-on-surface-variant">
                No leads for this period and filter.
              </td>
            </tr>
          )}
          {all.map((r) => {
            if (r.total && rows.length === 0) return null;
            const thin = !r.total && ratedCount(r.counts) < MIN_RATED_FOR_SIGNAL;
            const extra: Array<[DimKey, string]> = r.total ? [] : [[by, r.key]];
            const href = (q?: QualityBucket) => (r.total || linkable ? leadsHref(extra, q) : null);
            return (
              <tr
                key={r.key}
                className={
                  (r.total ? "border-t-2 border-outline-variant font-semibold " : "border-t border-outline-variant/60 ") +
                  (thin ? "text-on-surface-variant" : "")
                }
                title={thin ? `Fewer than ${MIN_RATED_FOR_SIGNAL} rated leads: too few to read the mix` : undefined}
              >
                <td className="py-sm pr-md font-medium">
                  {href() ? (
                    <Link href={href()!} className="hover:underline hover:text-primary">
                      {r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                </td>
                <CountCell value={r.counts.leads} href={null} />
                <CountCell value={ratedCount(r.counts)} href={null} />
                {LEAD_QUALITIES.map((q) => (
                  <CountCell key={q.value} value={r.counts.byBucket[q.value]} href={href(q.value)} />
                ))}
                <CountCell value={r.counts.byBucket.overdue} href={href("overdue")} />
                <td className="py-sm pr-md text-right font-mono whitespace-nowrap">{pct(badShare(r.counts))}</td>
                <CountCell value={r.counts.enrolled} href={null} />
                <td className="py-sm pr-md text-right font-mono whitespace-nowrap">
                  {pct(r.counts.leads ? (r.counts.enrolled / r.counts.leads) * 100 : null, 1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReasonList({ rows }: { rows: ReturnType<typeof reasonBreakdown> }) {
  if (rows.length === 0) return <p className="text-on-surface-variant text-body-md">No Poor or Junk ratings in this period.</p>;
  const max = Math.max(1, ...rows.map((r) => r.total));
  const poor = LEAD_QUALITIES.find((q) => q.value === "poor")!;
  const junk = LEAD_QUALITIES.find((q) => q.value === "junk")!;
  return (
    <div className="space-y-sm">
      <div className="flex items-center gap-md text-caption text-on-surface-variant">
        {[poor, junk].map((q) => (
          <span key={q.value} className="inline-flex items-center gap-xs">
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: q.color }} />
            {q.label}
          </span>
        ))}
      </div>
      <ol className="space-y-sm">
        {rows.map((r) => (
          <li key={r.label} title={`${r.poor} Poor · ${r.junk} Junk`}>
            <div className="flex items-baseline justify-between text-body-md">
              <span className="truncate pr-sm">{r.label}</span>
              <span className="font-mono font-semibold">{n(r.total)}</span>
            </div>
            <div className="h-2 rounded-full bg-surface-container mt-xs overflow-hidden flex gap-[2px]" style={{ width: `${(r.total / max) * 100}%` }}>
              {r.poor > 0 && <div className="h-full" style={{ flexGrow: r.poor, backgroundColor: poor.color }} />}
              {r.junk > 0 && <div className="h-full" style={{ flexGrow: r.junk, backgroundColor: junk.color }} />}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Enrolment rate per rating: Good leads should enrol far more often than Junk ones, or the ratings aren't being taken seriously. */
function HoldUp({ totals }: { totals: QualityCounts }) {
  const rows: Array<{ bucket: QualityBucket; label: string; color: string }> = [
    ...LEAD_QUALITIES.map((q) => ({ bucket: q.value as QualityBucket, label: q.label, color: q.color })),
    { bucket: "overdue", label: "Overdue (unrated)", color: QUALITY_UNRATED_COLOR },
  ];
  const vals = rows.map((r) => enrolRate(totals, r.bucket));
  const max = Math.max(1, ...vals.map((v) => v ?? 0));
  const good = enrolRate(totals, "good" as LeadQualityRating);
  const junk = enrolRate(totals, "junk" as LeadQualityRating);
  return (
    <div className="space-y-sm">
      <ol className="space-y-sm">
        {rows.map((r, i) => (
          <li key={r.bucket} title={`${totals.enrolledByBucket[r.bucket]} enrolled of ${totals.byBucket[r.bucket]}`}>
            <div className="flex items-baseline justify-between text-body-md">
              <span className="inline-flex items-center gap-xs">
                <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                {r.label}
                <span className="text-caption text-on-surface-variant">({n(totals.byBucket[r.bucket])} leads)</span>
              </span>
              <span className="font-mono font-semibold">{pct(vals[i], 1)}</span>
            </div>
            <div className="h-2 rounded-full bg-surface-container mt-xs overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${((vals[i] ?? 0) / max) * 100}%`, backgroundColor: r.color }} />
            </div>
          </li>
        ))}
      </ol>
      <p className="text-caption text-on-surface-variant">
        Share of each rating&apos;s leads that have enrolled.
        {good !== null && junk !== null && junk >= good
          ? " Junk leads are enrolling at least as often as Good ones, so the ratings deserve a second look."
          : " Good leads should enrol far more often than Junk ones; if they don't, the ratings deserve a second look."}
      </p>
    </div>
  );
}

function BdeTable({
  rows,
  team,
  leadsHref,
}: {
  rows: QualityGroupRow[];
  team: QualityCounts;
  leadsHref: (extra: Array<[DimKey, string]>, quality?: QualityBucket) => string | null;
}) {
  if (rows.length === 0) return <p className="text-on-surface-variant text-body-md">No leads for this period and filter.</p>;
  const teamBad = badShare(team);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-md">
        <thead className="text-on-surface-variant">
          <tr>
            <Th>BDE</Th>
            <Th right>Leads</Th>
            <Th right>Rated</Th>
            <Th right>Overdue</Th>
            <Th right>Good %</Th>
            <Th right title="Poor + Junk share of rated leads">Bad %</Th>
            <Th right title={`Gap to the team's bad-lead rate (${pct(teamBad)}); flagged at ${RATING_BIAS_POINTS}+ points once ${RATING_BIAS_MIN_RATED}+ leads are rated`}>
              vs team
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const gap = ratingBias(r.counts, team);
            const mine = badShare(r.counts);
            return (
              <tr key={r.key} className="border-t border-outline-variant/60">
                <td className="py-sm pr-md font-medium">{r.label}</td>
                <CountCell value={r.counts.leads} href={null} />
                <CountCell value={ratedCount(r.counts)} href={null} />
                <CountCell value={r.counts.byBucket.overdue} href={leadsHref([["bde", r.key]], "overdue")} />
                <td className="py-sm pr-md text-right font-mono">{pct(ratingShare(r.counts, "good"))}</td>
                <td className="py-sm pr-md text-right font-mono">{pct(mine)}</td>
                <td className="py-sm pr-md text-right whitespace-nowrap">
                  {gap !== null ? (
                    <span className="inline-flex items-center gap-xs font-semibold text-on-surface" title="Rates very differently from the team">
                      <span className="material-symbols-outlined text-amber-700" style={{ fontSize: 16 }}>
                        flag
                      </span>
                      {gap > 0 ? "+" : "−"}
                      {Math.abs(gap).toFixed(0)} pts
                    </span>
                  ) : mine !== null && teamBad !== null && ratedCount(r.counts) >= RATING_BIAS_MIN_RATED ? (
                    <span className="font-mono text-on-surface-variant">
                      {mine - teamBad >= 0 ? "+" : "−"}
                      {Math.abs(mine - teamBad).toFixed(0)} pts
                    </span>
                  ) : (
                    <span className="text-on-surface-variant">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
