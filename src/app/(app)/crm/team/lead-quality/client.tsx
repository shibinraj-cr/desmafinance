"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MultiSelect } from "@/components/MultiSelect";
import { AnalysisPeriodBar, rangeText, type AnalysisRange } from "@/components/AnalysisPeriodBar";
import { QualityDot } from "@/components/crm/LeadQualityPicker";
import { LEAD_QUALITIES, QUALITY_DUE_AFTER_DAYS } from "@/lib/crm-lead-quality";
import {
  RATING_BIAS_POINTS,
  badShare,
  ratedCount,
  ratedOnTimeShare,
  ratingShare,
  type QualityCounts,
} from "@/lib/lead-quality-report";
import {
  REVIEW_SPEND_JUNK_PCT,
  REVIEW_SPEND_MIN_RATED,
  type LqCampaignRow,
  type LqFilters,
  type LqReport,
} from "@/lib/crm-lead-quality-report";

/** Line colours for the trend's sources, by slot (validated categorical set). */
const SOURCE_COLORS = ["#2a78d6", "#eda100", "#008300", "#e87ba4"];

const n = (v: number) => v.toLocaleString("en-IN");
const pct = (v: number | null, digits = 0) => (v === null ? "—" : `${v.toFixed(digits)}%`);
const conv = (c: QualityCounts) => (c.leads ? (c.enrolled / c.leads) * 100 : null);

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

const FILTERS: Array<{ key: keyof LqFilters; label: string; placeholder: string }> = [
  { key: "source", label: "Source", placeholder: "All sources" },
  { key: "campaign", label: "Campaign", placeholder: "All campaigns" },
  { key: "service", label: "Service", placeholder: "All services" },
  { key: "bde", label: "BDE", placeholder: "All BDEs" },
];

export function CrmLeadQualityView({ report, range, filters }: { report: LqReport; range: AnalysisRange; filters: LqFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const push = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(search.toString());
    mutate(p);
    router.push(`${pathname}?${p.toString()}`);
  };
  const setPeriod = (period: string, from?: string, to?: string) =>
    push((p) => {
      p.set("period", period);
      if (period === "custom" && from && to) {
        p.set("from", from);
        p.set("to", to);
      } else {
        p.delete("from");
        p.delete("to");
      }
    });
  const setFilter = (key: keyof LqFilters, values: string[]) =>
    push((p) => {
      p.delete(key);
      for (const v of values) p.append(key, v);
    });
  const anyFilter = FILTERS.some((f) => filters[f.key].length > 0);

  /** The CRM leads list for this period + filters, narrowed further by `extra`. */
  const leadsHref = (extra: Partial<Record<"source" | "campaign" | "service" | "assignee", string>> = {}, quality?: string) => {
    const p = new URLSearchParams({ period: "custom", from: range.from, to: range.to });
    const base: Record<string, string[]> = {
      source: filters.source,
      campaign: filters.campaign,
      service: filters.service,
      assignee: filters.bde,
    };
    for (const [k, v] of Object.entries(extra)) if (v) base[k] = [v];
    for (const [k, vs] of Object.entries(base)) for (const v of vs) p.append(k, v);
    if (!base.assignee.length) p.set("assignee", "all");
    if (quality) p.set("quality", quality);
    return `/crm/leads?${p.toString()}`;
  };

  const cur = report.current;
  const prev = report.previous;
  const rated = ratedCount(cur);
  const due = rated + cur.byBucket.overdue;
  const bad = cur.byBucket.poor + cur.byBucket.junk;
  const prevLabel = rangeText(range.prevFrom, range.prevTo);

  return (
    <div className="p-margin space-y-lg">
      <AnalysisPeriodBar range={range} onChange={setPeriod} />

      <div className="flex flex-wrap items-center gap-sm">
        {FILTERS.map((f) => (
          <MultiSelect
            key={f.key}
            title={f.label}
            placeholder={f.placeholder}
            searchable
            options={report.options[f.key].map((o) => ({ value: o.value, label: o.label }))}
            selected={filters[f.key]}
            onChange={(next) => setFilter(f.key, next)}
          />
        ))}
        {anyFilter && (
          <button
            type="button"
            onClick={() => push((p) => FILTERS.forEach((f) => p.delete(f.key)))}
            className="text-label-sm text-accent font-semibold hover:underline"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto flex flex-wrap gap-sm">
          <Link
            href={leadsHref()}
            className="inline-flex items-center h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm font-semibold hover:border-primary"
          >
            Open in Leads
          </Link>
          <button
            type="button"
            onClick={() => downloadCsv(report)}
            className="inline-flex items-center gap-xs h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              download
            </span>
            Export CSV
          </button>
        </div>
      </div>

      {/* Headline numbers. Rating shares are of rated leads; changes compare with the previous period. */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-gutter">
        <Tile
          label="Leads created"
          value={n(cur.leads)}
          hint="Duplicates excluded"
          delta={countDelta(cur.leads, prev.leads)}
          deltaTitle={`vs ${prevLabel}`}
        />
        <Tile label="Rated on time" value={pct(ratedOnTimeShare(cur))} hint={`${n(rated)} rated of ${n(due)} due`} />
        <Tile
          label="Overdue ratings"
          value={n(report.overdue)}
          hint={`Unrated ${QUALITY_DUE_AFTER_DAYS}+ days`}
          danger={report.overdue > 0}
          href={report.overdue > 0 ? leadsHref({}, "overdue") : null}
        />
        <Tile
          label="Good"
          dot={LEAD_QUALITIES[0].color}
          value={pct(ratingShare(cur, "good"))}
          hint={`${n(cur.byBucket.good)} of ${n(rated)} rated`}
          delta={pointsDelta(ratingShare(cur, "good"), ratingShare(prev, "good"), true)}
          deltaTitle={`vs ${prevLabel}`}
          href={cur.byBucket.good ? leadsHref({}, "good") : null}
        />
        <Tile
          label="Bad (Poor + Junk)"
          value={pct(badShare(cur))}
          hint={`${n(bad)} of ${n(rated)} rated`}
          delta={pointsDelta(badShare(cur), badShare(prev), false)}
          deltaTitle={`vs ${prevLabel}`}
        />
        <Tile
          label="Junk"
          dot={LEAD_QUALITIES[3].color}
          value={pct(ratingShare(cur, "junk"))}
          hint={`${n(cur.byBucket.junk)} of ${n(rated)} rated`}
          delta={pointsDelta(ratingShare(cur, "junk"), ratingShare(prev, "junk"), false)}
          deltaTitle={`vs ${prevLabel}`}
          href={cur.byBucket.junk ? leadsHref({}, "junk") : null}
        />
      </section>

      <Panel title="Quality mix" subtitle={`${n(rated)} rated leads · shares are of rated leads only`}>
        <MixBar counts={cur} height={34} labels />
      </Panel>

      <Panel
        title="Campaign quality"
        subtitle={`Busiest first. Flagged “Review spend” when Junk is ${REVIEW_SPEND_JUNK_PCT}% or more of at least ${REVIEW_SPEND_MIN_RATED} rated leads.`}
        action={<QualityLegend />}
      >
        <CampaignTable report={report} leadsHref={leadsHref} />
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-gutter">
        <Panel title="Junk rate by source" subtitle="Share of each week’s rated leads marked Junk · last 8 complete weeks (Sat–Fri)">
          <TrendChart trend={report.trend} />
        </Panel>
        <Panel title="Why leads go bad" subtitle={`${n(bad)} Poor and Junk ratings, by the reason the BDE gave`}>
          <ReasonList report={report} />
        </Panel>
      </div>

      {/* Side by side only on very wide screens: the BDE table needs the width. */}
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-gutter">
        <Panel
          title="Rating discipline by BDE"
          subtitle={`Leads due a rating in this period. A flag means the BDE’s bad-lead rate is ${RATING_BIAS_POINTS}+ points from the team’s ${pct(badShare(cur))}.`}
        >
          <BdeTable report={report} leadsHref={leadsHref} />
        </Panel>
        <Panel
          title="Overdue ratings to chase"
          subtitle={`Longest overdue first · ${n(report.overdue)} leads past their ${QUALITY_DUE_AFTER_DAYS}-day rating date`}
          action={
            report.overdue > 0 ? (
              <Link
                href={leadsHref({}, "overdue")}
                className="inline-flex items-center h-9 px-md rounded-lg border border-outline-variant text-label-sm font-semibold hover:border-primary"
              >
                See all {n(report.overdue)}
              </Link>
            ) : null
          }
        >
          <OverdueList report={report} />
        </Panel>
      </div>

      <p className="text-caption text-on-surface-variant max-w-[980px]">
        Leads are CRM leads created in the period, duplicates excluded, with their current rating. A lead is due a rating{" "}
        {QUALITY_DUE_AFTER_DAYS} days after it enters the system; closing it asks sooner. Good / Average / Poor / Junk shares
        are out of rated leads only. Enrolled counts this period’s leads that have since enrolled. Changes compare with{" "}
        {prevLabel}. Every count opens the matching leads in the CRM.
      </p>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg min-w-0 space-y-md">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0">
          <h3 className="text-h3 text-on-surface">{title}</h3>
          {subtitle && <p className="text-label-sm text-on-surface-variant mt-xs">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

type Delta = { text: string; good: boolean } | null;

function countDelta(cur: number, prev: number): Delta {
  if (!prev) return null;
  const d = ((cur - prev) / prev) * 100;
  return { text: `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)}%`, good: d >= 0 };
}

/** Change in a share, in points; `upIsGood` decides the colour. */
function pointsDelta(cur: number | null, prev: number | null, upIsGood: boolean): Delta {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.5) return { text: "No change", good: true };
  return { text: `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)} pts`, good: d > 0 === upIsGood };
}

function Tile({
  label,
  value,
  hint,
  dot,
  danger,
  delta,
  deltaTitle,
  href,
}: {
  label: string;
  value: string;
  hint: string;
  dot?: string;
  danger?: boolean;
  delta?: Delta;
  deltaTitle?: string;
  href?: string | null;
}) {
  const body = (
    <>
      <p className="text-label-sm uppercase tracking-wider text-on-surface-variant inline-flex items-center gap-xs">
        {dot && <QualityDot color={dot} size={9} />}
        {label}
      </p>
      <p className={"text-h2 mt-xs font-mono " + (danger ? "text-error" : "text-on-surface")}>{value}</p>
      <p className="text-caption text-on-surface-variant mt-xs">{hint}</p>
      {delta && (
        <p className={"text-caption font-semibold mt-xs " + (delta.good ? "text-green-700" : "text-error")} title={deltaTitle}>
          {delta.text} <span className="font-normal text-on-surface-variant">vs previous</span>
        </p>
      )}
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

function QualityLegend() {
  return (
    <div className="flex flex-wrap gap-md text-caption text-on-surface">
      {LEAD_QUALITIES.map((q) => (
        <span key={q.value} className="inline-flex items-center gap-xs">
          <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: q.color }} />
          {q.label}
        </span>
      ))}
    </div>
  );
}

/** Rated mix as one 100% bar: a 2px gap between segments, labels in each segment's own ink. */
function MixBar({ counts, height, labels = false }: { counts: QualityCounts; height: number; labels?: boolean }) {
  const rated = ratedCount(counts);
  if (!rated) {
    return labels ? <p className="text-body-md text-on-surface-variant">No rated leads yet for this period and filter.</p> : (
      <div className="rounded bg-surface-container" style={{ height, width: 150 }} />
    );
  }
  const aria = LEAD_QUALITIES.map((q) => `${q.label} ${pct(ratingShare(counts, q.value))}`).join(", ");
  return (
    <div role="img" aria-label={aria} className="flex gap-[2px] overflow-hidden rounded-md" style={{ height, width: labels ? "100%" : 150 }}>
      {LEAD_QUALITIES.map((q) => {
        const share = (counts.byBucket[q.value] / rated) * 100;
        if (!share) return null;
        return (
          <div
            key={q.value}
            className="flex items-center overflow-hidden whitespace-nowrap text-label-sm font-semibold"
            style={{ width: `${share}%`, backgroundColor: q.color, color: q.ink, paddingLeft: labels ? 10 : 0 }}
            title={`${q.label}: ${counts.byBucket[q.value]} (${share.toFixed(0)}%)`}
          >
            {labels && share >= 9 ? `${q.label} ${share.toFixed(0)}%` : ""}
          </div>
        );
      })}
    </div>
  );
}

type HrefFn = (extra?: Partial<Record<"source" | "campaign" | "service" | "assignee", string>>, quality?: string) => string;

function Th({ children, right, title }: { children: React.ReactNode; right?: boolean; title?: string }) {
  return (
    <th title={title} className={"py-sm pr-md text-label-sm uppercase whitespace-nowrap font-semibold " + (right ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

function NumCell({ value, href, strong, danger }: { value: string | number; href?: string | null; strong?: boolean; danger?: boolean }) {
  const text = typeof value === "number" ? n(value) : value;
  return (
    <td
      className={
        "py-sm pr-md text-right font-mono whitespace-nowrap " +
        (strong ? "font-semibold " : "") +
        (danger ? "text-error font-semibold " : "") +
        (value === 0 ? "text-on-surface-variant" : "")
      }
    >
      {href && value !== 0 ? (
        <Link href={href} className="hover:underline hover:text-primary">
          {text}
        </Link>
      ) : (
        text
      )}
    </td>
  );
}

function CampaignTable({ report, leadsHref }: { report: LqReport; leadsHref: HrefFn }) {
  if (report.campaigns.length === 0) {
    return <p className="text-body-md text-on-surface-variant">No leads for this period and filter.</p>;
  }
  const row = (c: LqCampaignRow) => {
    const rated = ratedCount(c.counts);
    const href = (q?: string) => (c.campaign ? leadsHref({ campaign: c.campaign }, q) : null);
    return (
      <tr key={c.label} className={"border-t border-outline-variant/60 " + (c.flag ? "bg-error-container/20" : "")}>
        <td className="py-sm pr-md">
          <div className="flex flex-col gap-[3px]">
            {href() ? (
              <Link href={href()!} className="font-semibold text-on-surface hover:underline">
                {c.label}
              </Link>
            ) : (
              <span className="font-semibold text-on-surface">{c.label}</span>
            )}
            <div className="flex flex-wrap items-center gap-xs">
              {c.source && <span className="text-caption text-on-surface-variant border border-outline-variant rounded px-xs">{c.source}</span>}
              {c.flag && (
                <span className="inline-flex items-center gap-[3px] text-caption font-bold text-on-error-container bg-error-container rounded px-xs">
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                    flag
                  </span>
                  Review spend
                </span>
              )}
              {c.thin && rated > 0 && <span className="text-caption text-on-surface-variant">Too few rated to read</span>}
              {rated === 0 && <span className="text-caption text-on-surface-variant">Nothing rated yet</span>}
            </div>
          </div>
        </td>
        <NumCell value={c.counts.leads} />
        <NumCell value={rated} />
        <td className="py-sm pr-md">
          <MixBar counts={c.counts} height={12} />
        </td>
        <NumCell value={pct(ratingShare(c.counts, "good"))} href={href("good")} />
        <NumCell value={pct(ratingShare(c.counts, "junk"))} href={href("junk")} danger={c.flag} />
        <NumCell value={c.overdue} href={href("overdue")} />
        <td className="py-sm pr-md text-on-surface-variant">{c.topReason ?? "—"}</td>
        <NumCell value={c.counts.enrolled} />
        <NumCell value={pct(conv(c.counts), 1)} />
      </tr>
    );
  };
  const other = report.otherCampaigns;
  const total = report.current;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-md min-w-[1000px]">
        <thead className="text-on-surface-variant">
          <tr>
            <Th>Campaign</Th>
            <Th right>Leads</Th>
            <Th right>Rated</Th>
            <Th>Quality mix</Th>
            <Th right>Good</Th>
            <Th right>Junk</Th>
            <Th right title={`Unrated ${QUALITY_DUE_AFTER_DAYS}+ days after entering the system`}>Overdue</Th>
            <Th>Top bad reason</Th>
            <Th right title="Leads from this period that have since enrolled">Enrolled</Th>
            <Th right>Conv.</Th>
          </tr>
        </thead>
        <tbody>
          {report.campaigns.map(row)}
          {other && (
            <tr className="border-t border-outline-variant/60 text-on-surface-variant">
              <td className="py-sm pr-md">Other campaigns ({other.count})</td>
              <NumCell value={other.counts.leads} />
              <NumCell value={ratedCount(other.counts)} />
              <td className="py-sm pr-md">
                <MixBar counts={other.counts} height={12} />
              </td>
              <NumCell value={pct(ratingShare(other.counts, "good"))} />
              <NumCell value={pct(ratingShare(other.counts, "junk"))} />
              <NumCell value={other.overdue} />
              <td className="py-sm pr-md">—</td>
              <NumCell value={other.counts.enrolled} />
              <NumCell value={pct(conv(other.counts), 1)} />
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-outline-variant font-semibold">
            <td className="py-sm pr-md">All campaigns</td>
            <NumCell value={total.leads} strong />
            <NumCell value={ratedCount(total)} strong />
            <td className="py-sm pr-md" />
            <NumCell value={pct(ratingShare(total, "good"))} strong />
            <NumCell value={pct(ratingShare(total, "junk"))} strong />
            <NumCell value={report.overdue} strong />
            <td className="py-sm pr-md" />
            <NumCell value={total.enrolled} strong />
            <NumCell value={pct(conv(total), 1)} strong />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TrendChart({ trend }: { trend: LqReport["trend"] }) {
  if (trend.series.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Not enough rated leads in the last 8 weeks to draw a trend yet.</p>;
  }
  const data = trend.weeks.map((w, i) => {
    const point: Record<string, string | number | null> = { week: w.label };
    for (const s of trend.series) point[s.source] = s.values[i] === null ? null : Math.round(s.values[i]! * 10) / 10;
    return point;
  });
  const color = (i: number) => SOURCE_COLORS[i % SOURCE_COLORS.length];
  // Even ticks: tens up to the next ten above the highest point (twenties past 50%).
  const peak = Math.max(10, ...trend.series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const step = peak > 50 ? 20 : 10;
  const top = Math.ceil(peak / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e1e2e9" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} width={44} domain={[0, top]} ticks={ticks} />
          <Tooltip formatter={(v: number, name: string) => [`${v}%`, `${name} junk rate`]} />
          {/* Legend text stays in ink; the line colours alone carry identity. */}
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => <span className="text-on-surface">{v}</span>} />
          {trend.series.map((s) => (
            <Line
              key={s.source}
              type="linear"
              dataKey={s.source}
              stroke={color(s.colorIndex)}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, stroke: "#ffffff", fill: color(s.colorIndex) }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-caption text-on-surface-variant mt-xs">Gaps are weeks with too few rated leads from that source to read.</p>
    </div>
  );
}

function ReasonList({ report }: { report: LqReport }) {
  if (report.reasons.length === 0) {
    return <p className="text-body-md text-on-surface-variant">No Poor or Junk ratings in this period.</p>;
  }
  const max = Math.max(1, ...report.reasons.map((r) => r.total));
  const poor = LEAD_QUALITIES[2];
  const junk = LEAD_QUALITIES[3];
  return (
    <div className="space-y-md">
      <div className="flex gap-md text-caption text-on-surface">
        {[poor, junk].map((q) => (
          <span key={q.value} className="inline-flex items-center gap-xs">
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: q.color }} />
            {q.label}
          </span>
        ))}
      </div>
      <ol className="space-y-md">
        {report.reasons.map((r) => (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-md text-body-md">
              <span className="font-semibold">{r.label}</span>
              <span className="font-mono font-semibold">{n(r.total)}</span>
            </div>
            <div
              role="img"
              aria-label={`${r.poor} Poor, ${r.junk} Junk`}
              className="flex gap-[2px] h-2.5 rounded overflow-hidden mt-xs"
              style={{ width: `${(r.total / max) * 100}%` }}
            >
              {r.poor > 0 && <div style={{ flexGrow: r.poor, backgroundColor: poor.color }} />}
              {r.junk > 0 && <div style={{ flexGrow: r.junk, backgroundColor: junk.color }} />}
            </div>
            {r.topCampaign && <p className="text-caption text-on-surface-variant mt-xs">Mostly from {r.topCampaign}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function BdeTable({ report, leadsHref }: { report: LqReport; leadsHref: HrefFn }) {
  if (report.bdes.length === 0) {
    return <p className="text-body-md text-on-surface-variant">No ratings due in this period yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-md min-w-[560px]">
        <thead className="text-on-surface-variant">
          <tr>
            <Th>BDE</Th>
            <Th right>Due</Th>
            <Th>Rated on time</Th>
            <Th right>Overdue</Th>
            <Th right title="Days the oldest overdue rating has been waiting">Oldest</Th>
            <Th right>Bad % vs team</Th>
          </tr>
        </thead>
        <tbody>
          {report.bdes.map((b) => {
            const onTime = b.due ? (b.rated / b.due) * 100 : null;
            const barColor = onTime === null ? "transparent" : onTime >= 90 ? LEAD_QUALITIES[0].color : onTime >= 80 ? LEAD_QUALITIES[1].color : LEAD_QUALITIES[3].color;
            return (
              <tr key={b.id} className="border-t border-outline-variant/60">
                <td className="py-sm pr-md font-semibold">{b.name}</td>
                <NumCell value={b.due} />
                <td className="py-sm pr-md">
                  <div className="flex items-center gap-sm">
                    <div className="w-20 h-1.5 rounded-full bg-surface-container overflow-hidden">
                      <div className="h-full" style={{ width: `${onTime ?? 0}%`, backgroundColor: barColor }} />
                    </div>
                    <span className="font-mono">{pct(onTime)}</span>
                  </div>
                </td>
                <NumCell value={b.overdue} href={leadsHref({ assignee: b.id }, "overdue")} danger={b.overdue >= 20} />
                <td className="py-sm pr-md text-right font-mono text-on-surface-variant">{b.oldestDays === null ? "—" : `${b.oldestDays}d`}</td>
                <td className="py-sm text-right whitespace-nowrap">
                  <span className="font-mono">{pct(b.bad)}</span>
                  {b.biasGap !== null ? (
                    <span
                      className="ml-sm inline-flex items-center gap-[3px] text-caption font-bold text-on-surface bg-amber-100 rounded px-xs"
                      title="Rates very differently from the team"
                    >
                      <span className="material-symbols-outlined text-amber-800" style={{ fontSize: 13 }}>
                        flag
                      </span>
                      {b.biasGap > 0 ? "+" : "−"}
                      {Math.abs(b.biasGap).toFixed(0)} pts
                    </span>
                  ) : b.gap !== null ? (
                    <span className="ml-sm text-caption text-on-surface-variant">
                      {b.gap >= 0 ? "+" : "−"}
                      {Math.abs(b.gap).toFixed(0)} pts
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OverdueList({ report }: { report: LqReport }) {
  if (report.overdueList.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Nothing overdue. Every lead due a rating has one.</p>;
  }
  return (
    <ul className="divide-y divide-outline-variant/60">
      {report.overdueList.map((o) => (
        <li key={o.id} className="py-sm flex flex-wrap items-center gap-md">
          <div className="min-w-0 flex-1 basis-[220px]">
            <Link href={`/crm/leads/${o.id}`} className="font-semibold text-on-surface hover:underline break-words">
              {o.candidateName}
            </Link>
            <p className="text-caption text-on-surface-variant">
              {o.bde ?? "Unassigned"}
              {o.campaign ? ` · ${o.campaign}` : ""}
            </p>
          </div>
          <span className="text-caption text-on-surface-variant">Entered {fmtDay(o.createdAt)}</span>
          <span className="font-mono text-label-sm font-semibold text-error min-w-[88px] text-right">
            {o.overdueDays === 0 ? "Overdue" : `${o.overdueDays}d overdue`}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

function downloadCsv(report: LqReport) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const share = (c: QualityCounts, r: "good" | "average" | "poor" | "junk") => {
    const v = ratingShare(c, r);
    return v === null ? "" : v.toFixed(1);
  };
  const lines = [
    ["Campaign", "Source", "Leads", "Rated", "Good", "Average", "Poor", "Junk", "Good %", "Junk %", "Overdue", "Top bad reason", "Enrolled", "Review spend"]
      .map(esc)
      .join(","),
  ];
  for (const c of report.campaigns) {
    lines.push(
      [
        esc(c.label),
        esc(c.source ?? ""),
        c.counts.leads,
        ratedCount(c.counts),
        c.counts.byBucket.good,
        c.counts.byBucket.average,
        c.counts.byBucket.poor,
        c.counts.byBucket.junk,
        share(c.counts, "good"),
        share(c.counts, "junk"),
        c.overdue,
        esc(c.topReason ?? ""),
        c.counts.enrolled,
        c.flag ? "Yes" : "",
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "lead-quality-by-campaign.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
