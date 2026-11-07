/**
 * Daily and monthly lead trends per source for the Lead Pulse dashboard.
 * Two measures, side by side in every period:
 *   - received = leads that came in that IST day (Lead.createdAt), duplicates
 *     and bulk file uploads excluded — see `getCrmSourceDayFacts`
 *   - assigned = leads deliberately handed to a BDE that IST day, the same rule
 *     as the "Leads assigned" column in the source table
 *
 * Pure: the caller fetches the per-(day, source) counts and this only buckets
 * them, so it is unit-tested without a database. The monthly view is summed
 * from the same daily facts, so a month always equals the sum of its days.
 */
import { addDays } from "./lead-pulse-dates";
import { comparisonMonths, monthsEnding } from "./crm-monthly-comparison";

/** One (IST day, source) count. `sourceId` null = a lead with no source set. */
export type SourceDayFact = { day: string; sourceId: string | null; count: number };

export type TrendMeasure = "received" | "assigned";

export type TrendSeries = {
  /** The source id, or {@link OTHER_KEY} for the folded tail. */
  key: string;
  label: string;
  /** Categorical colour slot (0-based); null for the grey "Other" series. */
  slot: number | null;
};

export type TrendPeriod = {
  /** YYYY-MM-DD (daily) or YYYY-MM (monthly). */
  key: string;
  label: string;
  short: string;
  /** Today / this month — still filling, so it reads low. */
  partial: boolean;
  /** Counts aligned to `series` by index. */
  received: number[];
  assigned: number[];
};

export type SourceTrends = { series: TrendSeries[]; daily: TrendPeriod[]; monthly: TrendPeriod[] };

export const OTHER_KEY = "__other__";
/** Categorical slots the chart has colours for; a longer tail folds into "Other". */
export const MAX_SERIES = 8;

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Pick the series: every source with leads in the window gets its own colour
 * when there are at most {@link MAX_SERIES}; otherwise the biggest seven by
 * leads received keep theirs and the rest — plus leads with no source — share
 * "Other". Named series run in the source master's display order, the same
 * order as the source table, and take colour slots in that order.
 */
export function pickSeries(
  totals: Map<string | null, { received: number; assigned: number }>,
  sources: Array<{ id: string; label: string; displayOrder: number }>,
): TrendSeries[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const candidates = Array.from(totals.entries())
    .filter(([id, t]) => id != null && byId.has(id) && t.received + t.assigned > 0)
    .map(([id, t]) => ({ src: byId.get(id as string)!, ...t }));
  const hasUnsourced = (() => {
    const t = totals.get(null);
    return !!t && t.received + t.assigned > 0;
  })();

  const fits = candidates.length + (hasUnsourced ? 1 : 0) <= MAX_SERIES;
  const named = fits
    ? candidates
    : [...candidates]
        .sort((a, b) => b.received - a.received || b.assigned - a.assigned || a.src.displayOrder - b.src.displayOrder)
        .slice(0, MAX_SERIES - 1);
  named.sort((a, b) => a.src.displayOrder - b.src.displayOrder || a.src.label.localeCompare(b.src.label));

  const series: TrendSeries[] = named.map((c, i) => ({ key: c.src.id, label: c.src.label, slot: i }));
  if (!fits || hasUnsourced) {
    series.push({ key: OTHER_KEY, label: fits ? "No source" : "Other", slot: null });
  }
  return series;
}

export function buildSourceTrends(opts: {
  /** Today in IST, YYYY-MM-DD. */
  today: string;
  received: SourceDayFact[];
  assigned: SourceDayFact[];
  sources: Array<{ id: string; label: string; displayOrder: number }>;
  days?: number;
  months?: number;
}): SourceTrends {
  const days = opts.days ?? 30;
  const monthCount = opts.months ?? 12;
  const year = Number(opts.today.slice(0, 4));
  const month = Number(opts.today.slice(5, 7));
  const monthWindow = monthsEnding(year, month, monthCount);
  const firstMonth = monthWindow[0].value;
  const firstDay = addDays(opts.today, -(days - 1));
  // A source missing from the master is treated like no source at all.
  const known = new Set(opts.sources.map((s) => s.id));
  const norm = (id: string | null) => (id != null && known.has(id) ? id : null);

  // The series are chosen over the longer (monthly) window so the daily and
  // monthly views share one set of colours.
  const totals = new Map<string | null, { received: number; assigned: number }>();
  const tally = (facts: SourceDayFact[], measure: TrendMeasure) => {
    for (const f of facts) {
      if (f.day.slice(0, 7) < firstMonth || f.day > opts.today) continue;
      const id = norm(f.sourceId);
      const t = totals.get(id) ?? { received: 0, assigned: 0 };
      t[measure] += f.count;
      totals.set(id, t);
    }
  };
  tally(opts.received, "received");
  tally(opts.assigned, "assigned");
  const series = pickSeries(totals, opts.sources);
  const indexOf = new Map(series.map((s, i) => [s.key, i]));
  const otherIdx = indexOf.get(OTHER_KEY);
  const seriesIndex = (sourceId: string | null) => {
    const id = norm(sourceId);
    return (id != null ? indexOf.get(id) : undefined) ?? otherIdx;
  };

  const dayKeys: string[] = [];
  for (let i = 0; i < days; i++) dayKeys.push(addDays(firstDay, i));
  const daily: TrendPeriod[] = dayKeys.map((d) => {
    const dt = new Date(`${d}T00:00:00.000Z`);
    return {
      key: d,
      label: `${DAY_ABBR[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MONTH_ABBR[dt.getUTCMonth()]}`,
      short: `${dt.getUTCDate()} ${MONTH_ABBR[dt.getUTCMonth()]}`,
      partial: d === opts.today,
      received: series.map(() => 0),
      assigned: series.map(() => 0),
    };
  });
  const monthly: TrendPeriod[] = comparisonMonths(monthWindow, opts.today.slice(0, 7)).map((m) => ({
    key: m.value,
    label: m.label,
    short: m.short,
    partial: m.partial,
    received: series.map(() => 0),
    assigned: series.map(() => 0),
  }));
  const dayAt = new Map(daily.map((p) => [p.key, p]));
  const monthAt = new Map(monthly.map((p) => [p.key, p]));

  const place = (facts: SourceDayFact[], measure: TrendMeasure) => {
    for (const f of facts) {
      if (f.day > opts.today) continue;
      const idx = seriesIndex(f.sourceId);
      if (idx === undefined) continue;
      const m = monthAt.get(f.day.slice(0, 7));
      if (m) m[measure][idx] += f.count;
      const d = dayAt.get(f.day);
      if (d) d[measure][idx] += f.count;
    }
  };
  place(opts.received, "received");
  place(opts.assigned, "assigned");

  return { series, daily, monthly };
}
