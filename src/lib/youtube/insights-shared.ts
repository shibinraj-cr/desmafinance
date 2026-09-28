/**
 * YouTube Insights — the pure half. Types, format classification and every
 * statistic the page shows. No Prisma, no fetch: the client component imports
 * this directly and recomputes when the viewer switches the lead metric, and
 * tests/youtube-insights.test.ts pins the maths.
 *
 * Every statistic here is a CORRELATION. The page says so; nothing in this
 * module claims that a view caused a lead.
 */

export const YOUTUBE_INSIGHTS_HREF = "/marketing/youtube-insights";

/** Shorts can run up to 3 minutes (since Oct 2024). */
export const SHORT_MAX_SEC = 180;

export type VideoFormat = "short" | "video" | "live";

/** ISO-8601 duration ("PT1H2M3S", "P1DT2M") → seconds. Unparseable → 0. */
export function parseIsoDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return Math.round(Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0));
}

/**
 * The Data API does not flag Shorts, so this is a heuristic: anything that
 * was a live stream is "live"; otherwise ≤ 3 min is a Short. A long-form video
 * under 3 minutes would be miscounted — rare on this channel, and the daily
 * view split (shortsViews/videoViews) comes from YouTube Analytics, which
 * does know the real content type.
 */
export function classifyFormat(durationSec: number, isLive: boolean): VideoFormat {
  if (isLive) return "live";
  return durationSec > 0 && durationSec <= SHORT_MAX_SEC ? "short" : "video";
}

// ─── Data shapes the page hands to the client ─────────────────────────────

export type InsightsDay = {
  day: string; // YYYY-MM-DD (IST)
  /** Null when YouTube has no report for the day yet (not synced / ~2-day lag). */
  views: number | null;
  shortsViews: number | null;
  videoViews: number | null;
  subscribersNet: number | null;
  shortsPublished: number;
  videosPublished: number;
  ytLeads: number;
  voxbayLeads: number;
  /** Distinct Voxbay callers; null outside the uploaded call-report coverage. */
  voxbayCallers: number | null;
};

export type InsightsVideo = {
  id: string;
  title: string;
  publishDay: string;
  format: VideoFormat;
  viewCount: number;
  thumbnailUrl: string | null;
};

export type LeadMetric = "youtube" | "voxbay" | "both" | "callers";

export const LEAD_METRIC_LABELS: Record<LeadMetric, string> = {
  youtube: "YouTube leads",
  voxbay: "Voxbay leads",
  both: "YouTube + Voxbay leads",
  callers: "Voxbay unique callers",
};

export function leadValue(d: InsightsDay, metric: LeadMetric): number | null {
  switch (metric) {
    case "youtube":
      return d.ytLeads;
    case "voxbay":
      return d.voxbayLeads;
    case "both":
      return d.ytLeads + d.voxbayLeads;
    case "callers":
      return d.voxbayCallers;
  }
}

export type ViewMetric = "views" | "shortsViews" | "videoViews";

export const VIEW_METRIC_LABELS: Record<ViewMetric, string> = {
  views: "All views",
  shortsViews: "Shorts views",
  videoViews: "Long-video views",
};

// ─── Statistics ───────────────────────────────────────────────────────────

/** Pearson r over paired samples. Null below 3 pairs or with zero variance. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

export type Strength = "insufficient" | "none" | "weak" | "moderate" | "strong";

export type Correlation = {
  r: number | null;
  n: number;
  strength: Strength;
  /** |r| clears the ~95% bar for "not just noise" (|r| > 1.96/√n). */
  significant: boolean;
};

export const MIN_PAIRS = 12;

export function describe(r: number | null, n: number): Correlation {
  if (r === null || n < MIN_PAIRS) return { r, n, strength: "insufficient", significant: false };
  const a = Math.abs(r);
  const strength: Strength = a < 0.1 ? "none" : a < 0.3 ? "weak" : a < 0.5 ? "moderate" : "strong";
  return { r, n, strength, significant: a > 1.96 / Math.sqrt(n) };
}

function correlate(pairs: Array<[number | null, number | null]>): Correlation {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of pairs) {
    if (x === null || y === null) continue;
    xs.push(x);
    ys.push(y);
  }
  return describe(pearson(xs, ys), xs.length);
}

export type LagPoint = Correlation & { lag: number };

/**
 * r between x on day t and leads on day t+lag, for lag 0..maxLag. People
 * watch, then enquire days later — the lag with the highest r estimates that
 * delay. `best` is the highest POSITIVE r among usable lags.
 */
export function lagScan(
  days: InsightsDay[],
  x: (d: InsightsDay) => number | null,
  y: (d: InsightsDay) => number | null,
  maxLag = 7,
): { points: LagPoint[]; best: LagPoint | null } {
  const points: LagPoint[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    const pairs: Array<[number | null, number | null]> = [];
    for (let t = 0; t + lag < days.length; t++) pairs.push([x(days[t]), y(days[t + lag])]);
    points.push({ lag, ...correlate(pairs) });
  }
  let best: LagPoint | null = null;
  for (const p of points) {
    if (p.strength === "insufficient" || p.r === null || p.r <= 0) continue;
    if (!best || (best.r ?? 0) < p.r) best = p;
  }
  return { points, best };
}

export type Week = {
  weekStart: string; // Monday, YYYY-MM-DD
  views: number | null;
  shortsViews: number | null;
  videoViews: number | null;
  shortsPublished: number;
  videosPublished: number;
  leads: number | null;
};

function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Monday-start weekly totals. Only COMPLETE weeks (all 7 days present in the
 * series) are returned, and a week's views/leads are null unless every day
 * has a value — a half-synced week would read as a fake dip.
 */
export function weekly(days: InsightsDay[], metric: LeadMetric): Week[] {
  const groups = new Map<string, InsightsDay[]>();
  for (const d of days) {
    const k = mondayOf(d.day);
    const g = groups.get(k) ?? [];
    g.push(d);
    groups.set(k, g);
  }
  const sumOrNull = (g: InsightsDay[], f: (d: InsightsDay) => number | null) => {
    let s = 0;
    for (const d of g) {
      const v = f(d);
      if (v === null) return null;
      s += v;
    }
    return s;
  };
  const out: Week[] = [];
  for (const [weekStart, g] of Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (g.length !== 7) continue;
    out.push({
      weekStart,
      views: sumOrNull(g, (d) => d.views),
      shortsViews: sumOrNull(g, (d) => d.shortsViews),
      videoViews: sumOrNull(g, (d) => d.videoViews),
      shortsPublished: g.reduce((s, d) => s + d.shortsPublished, 0),
      videosPublished: g.reduce((s, d) => s + d.videosPublished, 0),
      leads: sumOrNull(g, (d) => leadValue(d, metric)),
    });
  }
  return out;
}

/**
 * Weekly correlation two ways:
 *  - `level`: this week's x vs this week's leads. Inflated when both simply
 *    grew over the period (a shared trend correlates with anything).
 *  - `change`: week-over-week CHANGE in x vs change in leads. Strips the trend
 *    — if this one holds up, the relationship is much more believable.
 */
export function weeklyCorrelation(
  weeks: Week[],
  x: (w: Week) => number | null,
): { level: Correlation; change: Correlation } {
  const level = correlate(weeks.map((w) => [x(w), w.leads]));
  const diffs: Array<[number | null, number | null]> = [];
  for (let i = 1; i < weeks.length; i++) {
    const x0 = x(weeks[i - 1]);
    const x1 = x(weeks[i]);
    const y0 = weeks[i - 1].leads;
    const y1 = weeks[i].leads;
    diffs.push([x0 === null || x1 === null ? null : x1 - x0, y0 === null || y1 === null ? null : y1 - y0]);
  }
  // Week-over-week needs fewer pairs to be worth reading; keep the same gate.
  return { level, change: correlate(diffs) };
}

export type UploadLift = {
  video: InsightsVideo;
  /** Leads on publish day + the next (window-1) days. */
  actual: number;
  /** Baseline daily average over the prior 14 days × window. */
  expected: number;
  lift: number;
  /** Other uploads within ±2 days — their effect is mixed into this one. */
  overlapping: number;
};

/**
 * For each upload: leads in the `window` days from its publish day vs what the
 * 14 days before would predict. Uploads without a full window or a full
 * baseline in the series are skipped rather than guessed.
 */
export function uploadLift(
  days: InsightsDay[],
  videos: InsightsVideo[],
  metric: LeadMetric,
  window = 3,
  baselineDays = 14,
): UploadLift[] {
  const idx = new Map(days.map((d, i) => [d.day, i]));
  const out: UploadLift[] = [];
  for (const v of videos) {
    const i = idx.get(v.publishDay);
    if (i === undefined || i - baselineDays < 0 || i + window > days.length) continue;
    let base = 0;
    let ok = true;
    for (let k = i - baselineDays; k < i; k++) {
      const val = leadValue(days[k], metric);
      if (val === null) {
        ok = false;
        break;
      }
      base += val;
    }
    let actual = 0;
    for (let k = i; k < i + window && ok; k++) {
      const val = leadValue(days[k], metric);
      if (val === null) ok = false;
      else actual += val;
    }
    if (!ok) continue;
    const expected = (base / baselineDays) * window;
    const overlapping = videos.filter((o) => {
      if (o.id === v.id) return false;
      const j = idx.get(o.publishDay);
      return j !== undefined && Math.abs(j - i) <= 2;
    }).length;
    out.push({ video: v, actual, expected: Math.round(expected * 10) / 10, lift: Math.round((actual - expected) * 10) / 10, overlapping });
  }
  return out;
}

/** Plain-language one-liner for a correlation, for the insight cards. */
export function strengthPhrase(c: Correlation): string {
  if (c.strength === "insufficient") return `Not enough data yet (${c.n} ${c.n === 1 ? "pair" : "pairs"}, need ${MIN_PAIRS}).`;
  const dir = (c.r ?? 0) >= 0 ? "positive" : "negative";
  const base =
    c.strength === "none" ? "No meaningful relationship" : `${c.strength[0].toUpperCase()}${c.strength.slice(1)} ${dir} relationship`;
  const sig = c.strength === "none" ? "" : c.significant ? " — unlikely to be chance" : " — could still be chance";
  return `${base} (r = ${(c.r ?? 0).toFixed(2)}, n = ${c.n})${sig}.`;
}
