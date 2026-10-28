/**
 * CRM → Activity → Lead Quality: the Marketing Admin's working view of lead
 * quality. Where the Executive tab (lead-quality-report.ts) summarises, this
 * one starts from CAMPAIGNS and points at what to act on — spend to review,
 * reasons leads go bad, BDEs and leads to chase — plus an 8-week junk trend.
 *
 * Pure: the page loads plain rows (crm-lead-quality-report-data.ts) and this
 * builds every number, so the rules are testable with literal rows. All rating
 * shares are out of RATED leads, as everywhere else.
 */
import { normalizeQuality, qualityBucket } from "./crm-lead-quality";
import {
  MIN_RATED_FOR_SIGNAL,
  addToCounts,
  badShare,
  emptyCounts,
  ratedCount,
  ratingBias,
  ratingShare,
  type QualityCounts,
} from "./lead-quality-report";
import { istDay, weekStartDay, ymdFromDay } from "./sales-analysis";

/** A campaign is flagged "Review spend" at this junk share… */
export const REVIEW_SPEND_JUNK_PCT = 35;
/** …once it has at least this many rated leads. */
export const REVIEW_SPEND_MIN_RATED = 30;
/** Weeks in the junk-rate trend (complete Sat–Fri weeks, newest last). */
export const TREND_WEEKS = 8;
/** Sources drawn in the trend; the rest are left out rather than given a 5th colour. */
export const TREND_MAX_SOURCES = 4;
/** Rows in the overdue chase list. */
export const OVERDUE_LIST_LIMIT = 10;
/** Campaign rows before the rest fold into "Other campaigns". */
export const CAMPAIGN_ROWS = 25;

export const NO_CAMPAIGN = "No campaign";

export type LqRow = {
  id: string;
  candidateName: string;
  createdAt: Date;
  sourceId: string | null;
  source: string | null;
  campaign: string | null;
  serviceId: string | null;
  service: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  qualityRating: string | null;
  qualityDueAt: Date | null;
  reason: string | null;
  statusCode: string;
  statusKind: string;
};

/** Page filters: ids for source / service / BDE, the raw text for campaign. */
export type LqFilters = { source: string[]; campaign: string[]; service: string[]; bde: string[] };

export type LqCampaignRow = {
  /** The raw campaign value (null = none), for links and filters. */
  campaign: string | null;
  label: string;
  /** Most common source among its leads. */
  source: string | null;
  sourceId: string | null;
  counts: QualityCounts;
  overdue: number;
  topReason: string | null;
  flag: boolean;
  thin: boolean;
};

export type LqReasonRow = { label: string; poor: number; junk: number; total: number; topCampaign: string | null };

export type LqBdeRow = {
  id: string;
  name: string;
  /** Leads whose rating has fallen due: rated + overdue. */
  due: number;
  rated: number;
  overdue: number;
  /** Days the oldest overdue rating has been waiting, or null. */
  oldestDays: number | null;
  bad: number | null;
  /** Signed gap to the team's bad-lead rate, in points, when ratingBias flags it. */
  biasGap: number | null;
  /** The plain gap, shown unflagged once enough leads are rated. */
  gap: number | null;
};

export type LqOverdueRow = {
  id: string;
  candidateName: string;
  bde: string | null;
  campaign: string | null;
  createdAt: string;
  overdueDays: number;
};

export type LqTrend = {
  weeks: Array<{ start: string; label: string }>;
  /** Junk share per week, or null where too few leads were rated to say. */
  series: Array<{ source: string; values: Array<number | null>; colorIndex: number }>;
};

export type LqReport = {
  options: {
    source: Array<{ value: string; label: string }>;
    campaign: Array<{ value: string; label: string }>;
    service: Array<{ value: string; label: string }>;
    bde: Array<{ value: string; label: string }>;
  };
  current: QualityCounts;
  previous: QualityCounts;
  overdue: number;
  campaigns: LqCampaignRow[];
  /** Campaigns past CAMPAIGN_ROWS, folded. */
  otherCampaigns: { count: number; counts: QualityCounts; overdue: number } | null;
  reasons: LqReasonRow[];
  bdes: LqBdeRow[];
  overdueList: LqOverdueRow[];
  trend: LqTrend;
};

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function matchesFilters(r: LqRow, f: LqFilters): boolean {
  if (f.source.length && !f.source.includes(r.sourceId ?? "")) return false;
  if (f.campaign.length && !f.campaign.includes(r.campaign ?? "")) return false;
  if (f.service.length && !f.service.includes(r.serviceId ?? "")) return false;
  if (f.bde.length && !f.bde.includes(r.assigneeId ?? "")) return false;
  return true;
}

function bucketOf(r: LqRow, now: Date) {
  return qualityBucket(
    { qualityRating: r.qualityRating, qualityDueAt: r.qualityDueAt, assignedToId: r.assigneeId, statusCode: r.statusCode },
    now,
  );
}

/** The most frequent key in a tally, ties broken alphabetically so output is stable. */
function topKey(tally: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of tally) {
    if (n > bestN || (n === bestN && best !== null && k < best)) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

function options(values: Map<string, string>): Array<{ value: string; label: string }> {
  return [...values.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function buildCrmLeadQualityReport(
  rows: LqRow[],
  opts: {
    /** Current period, half-open instants. */
    from: Date;
    to: Date;
    prevFrom: Date;
    prevTo: Date;
    now: Date;
    filters: LqFilters;
  },
): LqReport {
  const { from, to, prevFrom, prevTo, now, filters } = opts;
  const inCurrent = (r: LqRow) => r.createdAt >= from && r.createdAt < to;
  const inPrevious = (r: LqRow) => r.createdAt >= prevFrom && r.createdAt < prevTo;

  // Filter pickers list what the period holds, before any filter narrows it.
  const opt = { source: new Map<string, string>(), campaign: new Map<string, string>(), service: new Map<string, string>(), bde: new Map<string, string>() };
  for (const r of rows) {
    if (!inCurrent(r)) continue;
    if (r.sourceId) opt.source.set(r.sourceId, r.source ?? r.sourceId);
    if (r.campaign) opt.campaign.set(r.campaign, r.campaign);
    if (r.serviceId) opt.service.set(r.serviceId, r.service ?? r.serviceId);
    if (r.assigneeId) opt.bde.set(r.assigneeId, r.assigneeName ?? r.assigneeId);
  }

  const current = emptyCounts();
  const previous = emptyCounts();
  type CampaignAcc = { campaign: string | null; counts: QualityCounts; overdue: number; sources: Map<string, number>; sourceIds: Map<string, string>; reasons: Map<string, number> };
  const campaigns = new Map<string, CampaignAcc>();
  const reasons = new Map<string, { poor: number; junk: number; campaigns: Map<string, number> }>();
  type BdeAcc = { name: string; counts: QualityCounts; oldest: number | null };
  const bdes = new Map<string, BdeAcc>();
  const overdueRows: Array<{ row: LqRow; days: number }> = [];

  for (const r of rows) {
    if (!matchesFilters(r, filters)) continue;
    const bucket = bucketOf(r, now);
    const enrolled = r.statusKind === "won";
    if (inPrevious(r)) addToCounts(previous, bucket, enrolled);
    if (!inCurrent(r)) continue;
    addToCounts(current, bucket, enrolled);

    const ckey = r.campaign ?? "";
    let c = campaigns.get(ckey);
    if (!c) campaigns.set(ckey, (c = { campaign: r.campaign, counts: emptyCounts(), overdue: 0, sources: new Map(), sourceIds: new Map(), reasons: new Map() }));
    addToCounts(c.counts, bucket, enrolled);
    if (r.source) {
      bump(c.sources, r.source);
      if (r.sourceId) c.sourceIds.set(r.source, r.sourceId);
    }

    if (bucket === "poor" || bucket === "junk") {
      const label = r.reason ?? "No reason recorded";
      bump(c.reasons, label);
      let rr = reasons.get(label);
      if (!rr) reasons.set(label, (rr = { poor: 0, junk: 0, campaigns: new Map() }));
      rr[bucket] += 1;
      bump(rr.campaigns, r.campaign ?? NO_CAMPAIGN);
    }

    if (r.assigneeId) {
      let b = bdes.get(r.assigneeId);
      if (!b) bdes.set(r.assigneeId, (b = { name: r.assigneeName ?? "Unknown", counts: emptyCounts(), oldest: null }));
      addToCounts(b.counts, bucket, enrolled);
      if (bucket === "overdue") {
        const days = Math.max(0, Math.floor((now.getTime() - r.qualityDueAt!.getTime()) / DAY_MS));
        b.oldest = Math.max(b.oldest ?? 0, days);
      }
    }

    if (bucket === "overdue") {
      c.overdue += 1;
      overdueRows.push({ row: r, days: Math.max(0, Math.floor((now.getTime() - r.qualityDueAt!.getTime()) / DAY_MS)) });
    }
  }

  // ── Campaigns: busiest first; the long tail folds into one row. ──
  const campaignRows: LqCampaignRow[] = [...campaigns.values()]
    .map((c) => {
      const rated = ratedCount(c.counts);
      const junk = ratingShare(c.counts, "junk");
      const source = topKey(c.sources);
      return {
        campaign: c.campaign,
        label: c.campaign ?? NO_CAMPAIGN,
        source,
        sourceId: source ? (c.sourceIds.get(source) ?? null) : null,
        counts: c.counts,
        overdue: c.overdue,
        topReason: topKey(c.reasons),
        flag: rated >= REVIEW_SPEND_MIN_RATED && junk !== null && junk >= REVIEW_SPEND_JUNK_PCT,
        thin: rated < MIN_RATED_FOR_SIGNAL,
      };
    })
    .sort((a, b) => b.counts.leads - a.counts.leads || a.label.localeCompare(b.label));
  let otherCampaigns: LqReport["otherCampaigns"] = null;
  if (campaignRows.length > CAMPAIGN_ROWS) {
    const rest = campaignRows.splice(CAMPAIGN_ROWS);
    const counts = emptyCounts();
    let overdue = 0;
    for (const r of rest) {
      counts.leads += r.counts.leads;
      counts.enrolled += r.counts.enrolled;
      for (const k of Object.keys(counts.byBucket) as Array<keyof QualityCounts["byBucket"]>) {
        counts.byBucket[k] += r.counts.byBucket[k];
        counts.enrolledByBucket[k] += r.counts.enrolledByBucket[k];
      }
      overdue += r.overdue;
    }
    otherCampaigns = { count: rest.length, counts, overdue };
  }

  // ── Reasons, each with the campaign that produces most of it. ──
  const reasonRows: LqReasonRow[] = [...reasons.entries()]
    .map(([label, r]) => ({ label, poor: r.poor, junk: r.junk, total: r.poor + r.junk, topCampaign: topKey(r.campaigns) }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  // ── BDE rating discipline. ──
  const bdeRows: LqBdeRow[] = [...bdes.entries()]
    .map(([id, b]) => {
      const rated = ratedCount(b.counts);
      const overdue = b.counts.byBucket.overdue;
      const mine = badShare(b.counts);
      const team = badShare(current);
      return {
        id,
        name: b.name,
        due: rated + overdue,
        rated,
        overdue,
        oldestDays: b.oldest,
        bad: mine,
        biasGap: ratingBias(b.counts, current),
        gap: mine !== null && team !== null && rated >= 10 ? mine - team : null,
      };
    })
    .filter((b) => b.due > 0)
    .sort((a, b) => b.overdue - a.overdue || b.due - a.due || a.name.localeCompare(b.name));

  const overdueList: LqOverdueRow[] = overdueRows
    .sort((a, b) => b.days - a.days || a.row.createdAt.getTime() - b.row.createdAt.getTime())
    .slice(0, OVERDUE_LIST_LIMIT)
    .map(({ row, days }) => ({
      id: row.id,
      candidateName: row.candidateName,
      bde: row.assigneeName,
      campaign: row.campaign,
      createdAt: row.createdAt.toISOString(),
      overdueDays: days,
    }));

  return {
    options: { source: options(opt.source), campaign: options(opt.campaign), service: options(opt.service), bde: options(opt.bde) },
    current,
    previous,
    overdue: current.byBucket.overdue,
    campaigns: campaignRows,
    otherCampaigns,
    reasons: reasonRows,
    bdes: bdeRows,
    overdueList,
    trend: junkTrend(rows, { now, filters }),
  };
}

/** The last TREND_WEEKS complete Sat–Fri weeks before `now` (IST), oldest first, as day numbers. */
export function trendWeekStarts(now: Date): number[] {
  const thisWeek = weekStartDay(istDay(now));
  return Array.from({ length: TREND_WEEKS }, (_, i) => thisWeek - (TREND_WEEKS - i) * 7);
}

function weekLabel(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Junk share of rated leads, per source per week of creation. A source's
 * colour slot comes from its rank over the whole window BEFORE filters, so a
 * filter never repaints a line; a week with too few rated leads is a gap.
 */
function junkTrend(rows: LqRow[], opts: { now: Date; filters: LqFilters }): LqTrend {
  const starts = trendWeekStarts(opts.now);
  const first = starts[0];
  const end = starts[starts.length - 1] + 7;
  const weekIndex = (r: LqRow) => {
    const day = istDay(r.createdAt);
    if (day < first || day >= end) return -1;
    return Math.floor((day - first) / 7);
  };

  const rank = new Map<string, number>();
  const tallies = new Map<string, Array<{ rated: number; junk: number }>>();
  for (const r of rows) {
    const w = weekIndex(r);
    const rating = normalizeQuality(r.qualityRating);
    if (w < 0 || !rating || !r.source) continue;
    rank.set(r.source, (rank.get(r.source) ?? 0) + 1);
    if (!matchesFilters(r, opts.filters)) continue;
    let t = tallies.get(r.source);
    if (!t) tallies.set(r.source, (t = starts.map(() => ({ rated: 0, junk: 0 }))));
    t[w].rated += 1;
    if (rating === "junk") t[w].junk += 1;
  }
  const ranked = [...rank.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  const series = ranked
    .slice(0, TREND_MAX_SOURCES)
    .map((source, colorIndex) => ({
      source,
      colorIndex,
      values: (tallies.get(source) ?? starts.map(() => ({ rated: 0, junk: 0 }))).map((t) =>
        t.rated >= MIN_RATED_FOR_SIGNAL ? (t.junk / t.rated) * 100 : null,
      ),
    }))
    .filter((s) => s.values.some((v) => v !== null));
  return { weeks: starts.map((d) => ({ start: ymdFromDay(d), label: weekLabel(d) })), series };
}

