/**
 * Lead Quality report — the Executive → Sales Analysis → Lead Quality tab.
 *
 * Reads the same lead facts the Sales Analysis pivot ships (one per lead
 * created in the period, duplicates excluded) and answers the questions the
 * rating exists for: which sources and campaigns send genuine leads, why the
 * bad ones are bad, whether the ratings hold up against what actually enrolled,
 * and whether any BDE rates very differently from the team.
 *
 * Pure (no prisma) so the client re-cuts instantly and the tests drive it with
 * plain facts. Every share of a rating is out of RATED leads — counting the
 * unrated in the denominator would make a source look better or worse just
 * because its BDEs are behind on rating.
 */
import {
  FACT_LEAD,
  NOT_APPLICABLE,
  STORED_DIMS,
  bucketKey,
  bucketLabel,
  dimOptions,
  inRange,
  isTimeDim,
  matches,
  type Dicts,
  type DimKey,
  type Fact,
  type Filters,
} from "./sales-analysis";
import {
  LEAD_QUALITY_RATINGS,
  QUALITY_BUCKET_ORDER,
  qualityBucketLabel,
  type LeadQualityRating,
  type QualityBucket,
} from "./crm-lead-quality";

export type QualityCounts = {
  /** Leads created (in range, matching the filters). */
  leads: number;
  byBucket: Record<QualityBucket, number>;
  /** Of those leads, how many have since enrolled. */
  enrolled: number;
  enrolledByBucket: Record<QualityBucket, number>;
};

export const emptyCounts = (): QualityCounts => ({
  leads: 0,
  byBucket: Object.fromEntries(QUALITY_BUCKET_ORDER.map((b) => [b, 0])) as Record<QualityBucket, number>,
  enrolled: 0,
  enrolledByBucket: Object.fromEntries(QUALITY_BUCKET_ORDER.map((b) => [b, 0])) as Record<QualityBucket, number>,
});

/** Rated leads — the denominator for every rating share. */
export function ratedCount(c: QualityCounts): number {
  return LEAD_QUALITY_RATINGS.reduce((n, r) => n + c.byBucket[r], 0);
}

/** Share of RATED leads with this rating, in %, or null when none are rated. */
export function ratingShare(c: QualityCounts, rating: LeadQualityRating): number | null {
  const rated = ratedCount(c);
  return rated ? (c.byBucket[rating] / rated) * 100 : null;
}

/** Poor + Junk share of rated leads, in % — the "bad lead rate". */
export function badShare(c: QualityCounts): number | null {
  const rated = ratedCount(c);
  return rated ? ((c.byBucket.poor + c.byBucket.junk) / rated) * 100 : null;
}

/** Leads due a rating that have one, in %: rated ÷ (rated + overdue). Pending and exempt leads aren't late yet / ever. */
export function ratedOnTimeShare(c: QualityCounts): number | null {
  const rated = ratedCount(c);
  const base = rated + c.byBucket.overdue;
  return base ? (rated / base) * 100 : null;
}

/** Enrolment rate of the leads in one bucket, in %. */
export function enrolRate(c: QualityCounts, bucket: QualityBucket): number | null {
  const n = c.byBucket[bucket];
  return n ? (c.enrolledByBucket[bucket] / n) * 100 : null;
}

/** Dictionary label → bucket, for reading the `quality` slot back. */
function bucketByLabel(): Map<string, QualityBucket> {
  return new Map(QUALITY_BUCKET_ORDER.map((b) => [qualityBucketLabel(b), b]));
}

type Scope = { range: { from: number; to: number }; filters: Filters };

/** Lead facts in range that pass the filters, each with its quality bucket and outcome. */
function leadRows(facts: Fact[], dicts: Dicts, scope: Scope): Array<{ fact: Fact; bucket: QualityBucket; enrolled: boolean }> {
  const qSlot = STORED_DIMS.indexOf("quality");
  const oSlot = STORED_DIMS.indexOf("leadOutcome");
  const byLabel = bucketByLabel();
  const out: Array<{ fact: Fact; bucket: QualityBucket; enrolled: boolean }> = [];
  for (const f of facts) {
    if (f.kind !== FACT_LEAD) continue;
    if (!inRange(f, scope.range.from, scope.range.to)) continue;
    if (!matches(f, scope.filters)) continue;
    const label = f.dims[qSlot] >= 0 ? dicts.quality[f.dims[qSlot]] : undefined;
    const bucket = (label && byLabel.get(label)) || "exempt";
    const enrolled = f.dims[oSlot] >= 0 && dicts.leadOutcome[f.dims[oSlot]] === "Enrolled";
    out.push({ fact: f, bucket, enrolled });
  }
  return out;
}

function add(c: QualityCounts, bucket: QualityBucket, enrolled: boolean): void {
  c.leads += 1;
  c.byBucket[bucket] += 1;
  if (enrolled) {
    c.enrolled += 1;
    c.enrolledByBucket[bucket] += 1;
  }
}

export function qualityTotals(facts: Fact[], dicts: Dicts, scope: Scope): QualityCounts {
  const c = emptyCounts();
  for (const r of leadRows(facts, dicts, scope)) add(c, r.bucket, r.enrolled);
  return c;
}

export type QualityGroupRow = { key: string; label: string; counts: QualityCounts };

/**
 * Quality mix per bucket of `dim` (source, campaign, BDE, month, …). Time dims
 * keep calendar order; everything else is busiest first.
 */
export function qualityByGroup(facts: Fact[], dicts: Dicts, scope: Scope & { dim: DimKey }): QualityGroupRow[] {
  const rows = new Map<string, QualityGroupRow>();
  for (const r of leadRows(facts, dicts, scope)) {
    const key = bucketKey(r.fact, scope.dim);
    let row = rows.get(key);
    if (!row) {
      row = { key, label: bucketLabel(key, scope.dim, dicts), counts: emptyCounts() };
      rows.set(key, row);
    }
    add(row.counts, r.bucket, r.enrolled);
  }
  const list = [...rows.values()];
  if (isTimeDim(scope.dim)) list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  else list.sort((a, b) => b.counts.leads - a.counts.leads || a.label.localeCompare(b.label));
  return list;
}

export type ReasonRow = { label: string; poor: number; junk: number; total: number };

/** Why the Poor and Junk leads were rated so, most common first. */
export function reasonBreakdown(facts: Fact[], dicts: Dicts, scope: Scope): ReasonRow[] {
  const rSlot = STORED_DIMS.indexOf("qualityReason");
  const rows = new Map<string, ReasonRow>();
  for (const r of leadRows(facts, dicts, scope)) {
    if (r.bucket !== "poor" && r.bucket !== "junk") continue;
    const idx = r.fact.dims[rSlot];
    const label = idx >= 0 ? dicts.qualityReason[idx] : NOT_APPLICABLE;
    let row = rows.get(label);
    if (!row) rows.set(label, (row = { label, poor: 0, junk: 0, total: 0 }));
    row[r.bucket] += 1;
    row.total += 1;
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Below this many rated leads a row's mix is noise, not a signal — shown, but muted and never flagged. */
export const MIN_RATED_FOR_SIGNAL = 5;

/** A BDE whose bad-lead rate is this many points off the team's gets a second look. */
export const RATING_BIAS_POINTS = 20;
/** …but only once they've rated enough leads for the difference to mean something. */
export const RATING_BIAS_MIN_RATED = 10;

/**
 * Does this BDE rate very differently from the team? Same leads arrive through
 * the same channels, so a BDE marking far more (or far fewer) leads Poor/Junk
 * than everyone else is worth a conversation — about either the ratings or the
 * leads they're being given. Returns the gap in points, signed, or null.
 */
export function ratingBias(row: QualityCounts, team: QualityCounts): number | null {
  if (ratedCount(row) < RATING_BIAS_MIN_RATED) return null;
  const mine = badShare(row);
  const theirs = badShare(team);
  if (mine === null || theirs === null) return null;
  const gap = mine - theirs;
  return Math.abs(gap) >= RATING_BIAS_POINTS ? gap : null;
}

/** Filter-picker options for a dim, counted over lead facts only. */
export function leadDimOptions(facts: Fact[], dim: DimKey, dicts: Dicts) {
  return dimOptions(
    facts.filter((f) => f.kind === FACT_LEAD),
    dim,
    dicts,
  );
}

