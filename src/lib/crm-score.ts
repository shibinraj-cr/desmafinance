/**
 * L2 Scorecard — a composite 0–100 performance score per L2 BDE, decomposed into
 * four weighted components each with a plain-language explanation.
 *
 * Pure and unit-tested: it consumes the per-consultant rows already assembled by
 * {@link getTeamActivity} and derives scores without touching the DB (the
 * `TeamBdeRow` import below is type-only, so this module never loads prisma).
 *
 * Model — outcome-weighted:
 *   - Conversion       35  (enrolled ÷ assigned, this month)
 *   - Responsiveness   20  (median hours to first outbound contact)
 *   - Task discipline  20  (share of completed tasks finished on time)
 *   - Pipeline hygiene 25  (attention flags per active owned lead — a penalty band)
 *
 * Each component is clamped to its band. A component with no underlying data earns
 * its midpoint — a missing metric is neither rewarded nor punished — mirroring the
 * org `healthScore` in ceo-dashboard.ts. Windows follow the Team Activity page:
 * conversion is the current calendar month, responsiveness & discipline follow the
 * selected date range, hygiene is live (now).
 */
import type { TeamBdeRow } from "./crm-team";

/** Points each component contributes to the 0–100 total. */
export const SCORE_WEIGHTS = {
  conversion: 35,
  responsiveness: 20,
  discipline: 20,
  hygiene: 25,
} as const;

/** Month conversion % that earns full conversion marks. L2 conversions run low, so the ceiling is modest. */
export const CONVERSION_TARGET_PCT = 20;
/** Median first-response at/under this many hours earns full responsiveness marks. */
export const FIRST_RESPONSE_FAST_HOURS = 6;
/**
 * Hours at which responsiveness scores zero — the first-response SLA. Kept in sync
 * with `FIRST_RESPONSE_SLA_HOURS` in crm-team.ts (duplicated as a literal to keep
 * this module free of any runtime import, hence testable without a prisma mock).
 */
export const RESPONSE_SLA_HOURS = 24;
/** Attention flags per active owned lead at/above which pipeline hygiene scores zero. */
export const HYGIENE_ZERO_RATE = 1;

/** Names always excluded from the scorecard (belt-and-suspenders alongside the team-lead marker). */
export const SCORECARD_EXCLUDED_DISPLAY_NAMES = ["devika"];

export type ScoreComponentKey = "conversion" | "responsiveness" | "discipline" | "hygiene";

export type ScoreComponent = {
  key: ScoreComponentKey;
  label: string;
  /** Points earned, rounded, 0..max. */
  earned: number;
  max: number;
  /** True when the metric had no data and the component fell back to its midpoint. */
  neutral: boolean;
  /** One-line explanation of the underlying numbers, e.g. "18% — 11 enrolled of 62 assigned this month." */
  detail: string;
};

export type ScoreBand = "excellent" | "solid" | "developing" | "attention";

export type L2Score = {
  userId: string;
  displayName: string;
  role: string;
  /** 0–100, the sum of the (rounded) component points. */
  score: number;
  band: ScoreBand;
  bandLabel: string;
  components: ScoreComponent[];
  /** One–two sentences naming the top strength and the biggest drag. */
  narrative: string;
  /** False when the member had no activity in the window — rendered as "not scored". */
  scored: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Percentage `part/whole`, or null when there is nothing to divide by. */
function ratioPct(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/** Compact hours for narratives/details, matching the page's fmtHours. */
function fmtHours(h: number): string {
  if (h < 1) return "<1h";
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

// ── Per-component scorers (each returns unrounded `earned`) ───────────────────

function scoreConversion(row: TeamBdeRow): ScoreComponent {
  const max = SCORE_WEIGHTS.conversion;
  const p = row.conversionPct;
  if (p === null) {
    return { key: "conversion", label: "Conversion", earned: max / 2, max, neutral: true, detail: "No leads assigned this month yet." };
  }
  const earned = clamp((p / CONVERSION_TARGET_PCT) * max, 0, max);
  return {
    key: "conversion",
    label: "Conversion",
    earned,
    max,
    neutral: false,
    detail: `${Math.round(p)}% — ${row.enrolledMonth} enrolled of ${row.assignedMonth} assigned this month.`,
  };
}

function scoreResponsiveness(row: TeamBdeRow): ScoreComponent {
  const max = SCORE_WEIGHTS.responsiveness;
  const h = row.firstResponseMedianHours;
  if (h === null) {
    return { key: "responsiveness", label: "Responsiveness", earned: max / 2, max, neutral: true, detail: "No new leads assigned in this period." };
  }
  const span = RESPONSE_SLA_HOURS - FIRST_RESPONSE_FAST_HOURS;
  const earned = clamp((1 - (h - FIRST_RESPONSE_FAST_HOURS) / span) * max, 0, max);
  const pending = row.firstResponsePending > 0 ? `, ${row.firstResponsePending} awaiting first contact` : "";
  return {
    key: "responsiveness",
    label: "Responsiveness",
    earned,
    max,
    neutral: false,
    detail: `Median first reply ${fmtHours(h)} vs the ${RESPONSE_SLA_HOURS}h SLA${pending}.`,
  };
}

function scoreDiscipline(row: TeamBdeRow): ScoreComponent {
  const max = SCORE_WEIGHTS.discipline;
  const rate = ratioPct(row.tasksOnTime, row.tasksCompleted);
  if (rate === null) {
    return { key: "discipline", label: "Task discipline", earned: max / 2, max, neutral: true, detail: "No tasks completed in this period." };
  }
  const earned = clamp((rate / 100) * max, 0, max);
  return {
    key: "discipline",
    label: "Task discipline",
    earned,
    max,
    neutral: false,
    detail: `${Math.round(rate)}% of ${row.tasksCompleted} completed task${row.tasksCompleted === 1 ? "" : "s"} were on time.`,
  };
}

function scoreHygiene(row: TeamBdeRow): ScoreComponent {
  const max = SCORE_WEIGHTS.hygiene;
  const issues = row.slaBreaches + row.abandoned + row.stuck + row.noTask;
  const book = row.activeOwned;
  if (book === 0) {
    return { key: "hygiene", label: "Pipeline hygiene", earned: max, max, neutral: false, detail: "No active leads on the book." };
  }
  const earned = clamp((1 - issues / book / HYGIENE_ZERO_RATE) * max, 0, max);
  const detail =
    issues === 0
      ? `A clean book — none of ${book} active lead${book === 1 ? "" : "s"} are flagged.`
      : `${issues} attention flag${issues === 1 ? "" : "s"} across ${book} active leads (${row.slaBreaches} SLA · ${row.abandoned} abandoned · ${row.stuck} stuck · ${row.noTask} no next step).`;
  return { key: "hygiene", label: "Pipeline hygiene", earned, max, neutral: false, detail };
}

// ── Narrative ────────────────────────────────────────────────────────────────

function strengthClause(row: TeamBdeRow, key: ScoreComponentKey): string {
  switch (key) {
    case "conversion":
      return `strong conversion at ${Math.round(row.conversionPct ?? 0)}%`;
    case "responsiveness":
      return `quick first responses (median ${fmtHours(row.firstResponseMedianHours ?? 0)})`;
    case "discipline":
      return `reliable task follow-through (${Math.round(ratioPct(row.tasksOnTime, row.tasksCompleted) ?? 0)}% on time)`;
    case "hygiene":
      return "a well-tended pipeline";
  }
}

function dragClause(row: TeamBdeRow, key: ScoreComponentKey): string {
  const issues = row.slaBreaches + row.abandoned + row.stuck + row.noTask;
  switch (key) {
    case "conversion":
      return `conversion is low at ${Math.round(row.conversionPct ?? 0)}%`;
    case "responsiveness":
      return `first responses are slow (median ${fmtHours(row.firstResponseMedianHours ?? 0)})`;
    case "discipline":
      return `task timeliness is slipping (${Math.round(ratioPct(row.tasksOnTime, row.tasksCompleted) ?? 0)}% on time)`;
    case "hygiene":
      return `${issues} lead${issues === 1 ? "" : "s"} need attention (SLA, abandoned, stuck or no next step)`;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Build the explanation: the highest-scoring component as the strength, the lowest as the drag. */
function buildNarrative(components: ScoreComponent[], row: TeamBdeRow): string {
  const withData = components.filter((c) => !c.neutral);
  if (withData.length === 0) return "Not enough data yet to explain this score.";
  const fill = (c: ScoreComponent) => c.earned / c.max;
  const sorted = [...withData].sort((a, b) => fill(b) - fill(a));
  const top = sorted[0];
  const low = sorted[sorted.length - 1];
  const strength = strengthClause(row, top.key);
  // All strong, or only one component with data → no meaningful drag to call out.
  if (top.key === low.key || fill(low) >= 0.8) {
    return capitalize(`${strength} — solid across the board.`);
  }
  return capitalize(`${strength}, but ${dragClause(row, low.key)}.`);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Score bands: label + inclusive lower bound, highest first. Single source of
 * truth for both the scorer and the guide page (`/crm/team/scorecard-guide`), so
 * the two never drift. `attention` has `min: 0`, catching everything below 50.
 */
export const SCORE_BANDS: ReadonlyArray<{ key: ScoreBand; label: string; min: number }> = [
  { key: "excellent", label: "Excellent", min: 80 },
  { key: "solid", label: "Solid", min: 65 },
  { key: "developing", label: "Developing", min: 50 },
  { key: "attention", label: "Needs attention", min: 0 },
];

function bandFor(score: number): ScoreBand {
  return (SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1]).key;
}

const BAND_LABEL: Record<ScoreBand, string> = Object.fromEntries(
  SCORE_BANDS.map((b) => [b.key, b.label]),
) as Record<ScoreBand, string>;

/** Score one consultant row into a full {@link L2Score}. Pure. */
export function scoreL2Member(row: TeamBdeRow): L2Score {
  const components = [scoreConversion(row), scoreResponsiveness(row), scoreDiscipline(row), scoreHygiene(row)].map(
    (c) => ({ ...c, earned: Math.round(c.earned) }),
  );
  // Sum the rounded components so the displayed parts always add up to the total.
  const score = components.reduce((s, c) => s + c.earned, 0);
  const band = bandFor(score);
  const scored =
    row.activeOwned > 0 || row.contacts > 0 || row.tasksCompleted > 0 || row.assignedMonth > 0 || row.assignedRange > 0;
  return {
    userId: row.userId,
    displayName: row.displayName,
    role: row.role,
    score,
    band,
    bandLabel: BAND_LABEL[band],
    components,
    narrative: scored ? buildNarrative(components, row) : "No activity in this period — not scored.",
    scored,
  };
}

/**
 * Build the ranked L2 Scorecard from a set of consultant rows: keep only L2 BDEs,
 * drop CRM managers (`excludeUserIds`) and the always-excluded names, score each,
 * and sort scored members by score (desc), unscored members last.
 */
export function buildL2Scorecard(
  rows: TeamBdeRow[],
  opts: { excludeUserIds?: Iterable<string> } = {},
): L2Score[] {
  const excluded = new Set(opts.excludeUserIds ?? []);
  return rows
    .filter(
      (r) =>
        r.role === "l2" &&
        !excluded.has(r.userId) &&
        !SCORECARD_EXCLUDED_DISPLAY_NAMES.includes(r.displayName.trim().toLowerCase()),
    )
    .map(scoreL2Member)
    .sort(
      (a, b) =>
        Number(b.scored) - Number(a.scored) ||
        b.score - a.score ||
        a.displayName.localeCompare(b.displayName),
    );
}
