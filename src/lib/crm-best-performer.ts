/**
 * Best Performer — the monthly headline on the Team Activity page (`/crm/team`).
 * One points total (0–100) per L2 BDE for a calendar month, from three parts,
 * each first put on a 0–100 scale:
 *
 *   - Enrollments  50%  enrolled ÷ the month's Lead Pulse target × 100, capped at
 *                       100. No target set → 0 (there is nothing to measure against).
 *   - L2 Scorecard 25%  the member's L2 Scorecard score for the month (0–100);
 *                       0 when the scorecard has no activity to score.
 *   - Conversion   25%  10 × conversion % (1.5% → 15), capped at 100 — so 10%
 *                       conversion or better earns the full part.
 *
 * Pure and unit-tested: it combines the already-built L2 Scorecard with the
 * consultant rows from {@link getTeamActivity} and a target map, never touching
 * the DB (both imports below are type-only). The eligible set is exactly the
 * scorecard's — L2 BDEs minus CRM managers and the team lead.
 */
import type { L2Score } from "./crm-score";
import type { TeamBdeRow } from "./crm-team";

/** Share of the 100-point total each part carries. */
export const BEST_PERFORMER_WEIGHTS = {
  enrollment: 50,
  scorecard: 25,
  conversion: 25,
} as const;

/** Conversion score per conversion percentage point (1.5% → 15). */
export const CONVERSION_SCORE_PER_PCT = 10;

export type BestPerformerEntry = {
  userId: string;
  displayName: string;
  enrolled: number;
  /** The month's total enrollment target; 0 when none is set. */
  target: number;
  /** Enrollments ÷ target on a 0–100 scale. */
  enrollmentScore: number;
  /** L2 Scorecard score, 0–100 (0 when not scored). */
  scorecardScore: number;
  scored: boolean;
  /** Enrolled ÷ assigned for the month, or null when nothing was assigned. */
  conversionPct: number | null;
  assigned: number;
  /** 10 × conversion %, on a 0–100 scale. */
  conversionScore: number;
  /** Each part's weighted contribution (one decimal) — these sum to `points`. */
  parts: { enrollment: number; scorecard: number; conversion: number };
  /** 0–100, one decimal. */
  points: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Enrollment score: share of target achieved, 0–100. No target → 0. */
export function enrollmentScore(enrolled: number, target: number): number {
  if (target <= 0) return 0;
  return clamp((enrolled / target) * 100, 0, 100);
}

/** Conversion score: 10 × conversion %, 0–100. No assigned leads → 0. */
export function conversionScore(conversionPct: number | null): number {
  if (conversionPct === null) return 0;
  return clamp(conversionPct * CONVERSION_SCORE_PER_PCT, 0, 100);
}

/**
 * Rank the month's L2 BDEs by points (desc); ties go to more enrollments, then
 * the higher scorecard score, then name. `scorecard` must be built from `rows`
 * for the same month; `targets` maps userId → the month's total target.
 */
export function buildBestPerformers(
  scorecard: L2Score[],
  rows: TeamBdeRow[],
  targets: ReadonlyMap<string, number>,
): BestPerformerEntry[] {
  const rowById = new Map(rows.map((r) => [r.userId, r]));
  return scorecard
    .map((s): BestPerformerEntry => {
      const row = rowById.get(s.userId);
      const enrolled = row?.enrolledPeriod ?? 0;
      const target = targets.get(s.userId) ?? 0;
      const conversionPct = row?.conversionPct ?? null;
      const eScore = enrollmentScore(enrolled, target);
      const sScore = s.scored ? s.score : 0;
      const cScore = conversionScore(conversionPct);
      const parts = {
        enrollment: round1((eScore * BEST_PERFORMER_WEIGHTS.enrollment) / 100),
        scorecard: round1((sScore * BEST_PERFORMER_WEIGHTS.scorecard) / 100),
        conversion: round1((cScore * BEST_PERFORMER_WEIGHTS.conversion) / 100),
      };
      return {
        userId: s.userId,
        displayName: s.displayName,
        enrolled,
        target,
        enrollmentScore: round1(eScore),
        scorecardScore: sScore,
        scored: s.scored,
        conversionPct,
        assigned: row?.assignedPeriod ?? 0,
        conversionScore: round1(cScore),
        parts,
        // Sum the rounded parts so the displayed parts always add up to the total.
        points: round1(parts.enrollment + parts.scorecard + parts.conversion),
      };
    })
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.enrolled - a.enrolled ||
        b.scorecardScore - a.scorecardScore ||
        a.displayName.localeCompare(b.displayName),
    );
}
