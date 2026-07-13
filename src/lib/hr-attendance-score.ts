/**
 * Attendance Scorecard — a composite 0–100 attendance-behaviour score per
 * employee, decomposed into four weighted components each with a plain-language
 * explanation. It mirrors the CRM L2 Scorecard ({@link ./crm-score.ts}): pure,
 * DB-free and unit-tested, consuming a pre-assembled per-employee row.
 *
 * Model — presence-weighted, over a rolling multi-cycle window:
 *   - Presence         45  (attended ÷ rostered, half-days count half; paid leave excluded)
 *   - Punctuality      30  (share of worked days late beyond the grace + LCE allowance — "AL")
 *   - Full-day         15  (share of worked days left early — the early-out signal)
 *   - Discipline       10  (missing-punch + regularisation incidents — a penalty band)
 *
 * This is deliberately NOT a re-derivation of pay: payroll already docks AL and
 * HD as loss-of-pay. The score is a behavioural summary for review, recognition
 * and flagging. Two policy calls, per the product owner:
 *   • LCE (late-coming within the granted allowance) is fully free — it never
 *     dents punctuality, matching how payroll treats it.
 *   • Authorised paid leave (LV) never dents presence — it is excluded from the
 *     presence denominator, so approved leave is not penalised.
 *
 * Each component is clamped to its band. A component with no underlying data
 * earns its midpoint — a missing metric is neither rewarded nor punished —
 * mirroring `crm-score.ts` and the org `healthScore` in ceo-dashboard.ts.
 */

/** Points each component contributes to the 0–100 total. */
export const ATT_SCORE_WEIGHTS = {
  presence: 45,
  punctuality: 30,
  completion: 15,
  discipline: 10,
} as const;

// ── Tuning constants (named so they read as policy, not magic numbers) ────────

/** Attendance rate at/above which Presence earns full marks. */
export const PRESENCE_FULL_RATE = 0.98;
/** Attendance rate at/below which Presence scores zero. Between the two it ramps linearly. */
export const PRESENCE_ZERO_RATE = 0.75;

/** Share of worked days flagged AL at/above which Punctuality scores zero. */
export const PUNCTUALITY_ZERO_RATE = 0.5;

/** Share of worked days with an early departure at/above which Full-day scores zero. */
export const COMPLETION_ZERO_RATE = 0.4;

/** Discipline incidents (missing punch + regularisations) as a share of worked days that zeroes the score… */
export const DISCIPLINE_CAP_RATE = 0.15;
/** …but never a cap below this many incidents, so small-sample employees aren't zeroed by one slip. */
export const DISCIPLINE_CAP_FLOOR = 4;

/**
 * Minimum rostered days (P + HD + A) an employee needs in the window before we
 * publish a score. Below this, a handful of days would produce a volatile,
 * misleading score — so the employee is marked "insufficient data": not scored,
 * not ranked, and never on the attention flag list. ~20 ≈ one salary cycle.
 */
export const MIN_ROSTERED_DAYS = 20;

export type AttScoreComponentKey = "presence" | "punctuality" | "completion" | "discipline";

export type AttScoreComponent = {
  key: AttScoreComponentKey;
  label: string;
  /** Points earned, rounded, 0..max. */
  earned: number;
  max: number;
  /** True when the metric had no data and the component fell back to its midpoint. */
  neutral: boolean;
  /** One-line explanation of the underlying numbers. */
  detail: string;
};

export type AttScoreBand = "excellent" | "solid" | "developing" | "attention";

/**
 * One employee's aggregated attendance signals over the rolling window. All
 * counts are summed across the cycles covered; AL/LCE are computed per cycle
 * (the LCE quota is per-cycle) and then summed by the DB layer.
 */
export type AttendanceScoreRow = {
  employeeId: string;
  empCode: string;
  name: string;
  designation: string | null;
  /** Present-equivalent full days (P + OD + REG). */
  daysPresent: number;
  /** Half-days (HD). */
  daysHalfDay: number;
  /** Absent / loss-of-pay days (A), including sandwich-flipped WO/HL. */
  daysAbsent: number;
  /** Full-day authorised paid leave (LV) — excluded from presence. */
  daysPaidLeave: number;
  /** Worked days flagged AL (late beyond grace + LCE allowance). */
  alDays: number;
  /** Worked days flagged LCE (late but within the granted allowance) — informational. */
  lceDays: number;
  /** Worked days with an early departure beyond the grace. */
  earlyOutDays: number;
  /** Worked days with exactly one punch (a missing in/out). */
  missingPunchDays: number;
  /** Regularisation requests submitted in the window. */
  regRequests: number;
  /** Number of salary cycles the window spans (for the detail text). */
  cyclesCovered: number;
};

export type AttendanceScore = {
  employeeId: string;
  empCode: string;
  name: string;
  designation: string | null;
  /** 0–100, the sum of the (rounded) component points. */
  score: number;
  band: AttScoreBand;
  bandLabel: string;
  components: AttScoreComponent[];
  /** One–two sentences naming the top strength and the biggest drag. */
  narrative: string;
  /** False when the employee had no attendance in the window — rendered as "not scored". */
  scored: boolean;
  /** Raw aggregates carried through for the UI table. */
  stats: {
    workedDays: number;
    present: number;
    halfDay: number;
    absent: number;
    paidLeave: number;
    alDays: number;
    lceDays: number;
    earlyOutDays: number;
    missingPunchDays: number;
    regRequests: number;
    cyclesCovered: number;
    /** Attendance rate (P + 0.5·HD)/(P+HD+A), or null when nothing was rostered. */
    attendancePct: number | null;
  };
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Present-equivalent ÷ rostered, or null when there is nothing rostered. */
function attendanceRate(row: AttendanceScoreRow): number | null {
  const rostered = row.daysPresent + row.daysHalfDay + row.daysAbsent;
  if (rostered <= 0) return null;
  return (row.daysPresent + 0.5 * row.daysHalfDay) / rostered;
}

/** Worked days = the days on which lateness / early-out / punches are a concept. */
function workedDays(row: AttendanceScoreRow): number {
  return row.daysPresent + row.daysHalfDay;
}

// ── Per-component scorers (each returns unrounded `earned`) ───────────────────

function scorePresence(row: AttendanceScoreRow): AttScoreComponent {
  const max = ATT_SCORE_WEIGHTS.presence;
  const rate = attendanceRate(row);
  if (rate === null) {
    return { key: "presence", label: "Presence", earned: max / 2, max, neutral: true, detail: "No rostered days in this window yet." };
  }
  const span = PRESENCE_FULL_RATE - PRESENCE_ZERO_RATE;
  const earned = clamp(((rate - PRESENCE_ZERO_RATE) / span) * max, 0, max);
  const pct = Math.round(rate * 100);
  return {
    key: "presence",
    label: "Presence",
    earned,
    max,
    neutral: false,
    detail: `${pct}% attended — ${row.daysPresent} present, ${row.daysHalfDay} half-day, ${row.daysAbsent} absent over ${row.cyclesCovered} cycle${row.cyclesCovered === 1 ? "" : "s"}.`,
  };
}

function scorePunctuality(row: AttendanceScoreRow): AttScoreComponent {
  const max = ATT_SCORE_WEIGHTS.punctuality;
  const worked = workedDays(row);
  if (worked <= 0) {
    return { key: "punctuality", label: "Punctuality", earned: max / 2, max, neutral: true, detail: "No worked days to judge punctuality." };
  }
  const alRate = row.alDays / worked;
  const earned = clamp((1 - alRate / PUNCTUALITY_ZERO_RATE) * max, 0, max);
  const lce = row.lceDays > 0 ? `, ${row.lceDays} within the late-coming allowance` : "";
  const detail =
    row.alDays === 0
      ? `On time every worked day${lce ? ` (${row.lceDays} within the late-coming allowance)` : ""}.`
      : `Late beyond the allowance on ${row.alDays} of ${worked} worked days${lce}.`;
  return { key: "punctuality", label: "Punctuality", earned, max, neutral: false, detail };
}

function scoreCompletion(row: AttendanceScoreRow): AttScoreComponent {
  const max = ATT_SCORE_WEIGHTS.completion;
  const worked = workedDays(row);
  if (worked <= 0) {
    return { key: "completion", label: "Full-day", earned: max / 2, max, neutral: true, detail: "No worked days to judge early departures." };
  }
  const rate = row.earlyOutDays / worked;
  const earned = clamp((1 - rate / COMPLETION_ZERO_RATE) * max, 0, max);
  const detail =
    row.earlyOutDays === 0
      ? `Completed the shift on all ${worked} worked days.`
      : `Left early on ${row.earlyOutDays} of ${worked} worked days.`;
  return { key: "completion", label: "Full-day", earned, max, neutral: false, detail };
}

function scoreDiscipline(row: AttendanceScoreRow): AttScoreComponent {
  const max = ATT_SCORE_WEIGHTS.discipline;
  const worked = workedDays(row);
  if (worked <= 0) {
    return { key: "discipline", label: "Discipline", earned: max / 2, max, neutral: true, detail: "No worked days to judge punch discipline." };
  }
  const incidents = row.missingPunchDays + row.regRequests;
  const cap = Math.max(DISCIPLINE_CAP_FLOOR, worked * DISCIPLINE_CAP_RATE);
  const earned = clamp((1 - incidents / cap) * max, 0, max);
  const detail =
    incidents === 0
      ? "Clean — no missing punches or corrections."
      : `${row.missingPunchDays} missing punch${row.missingPunchDays === 1 ? "" : "es"} · ${row.regRequests} correction${row.regRequests === 1 ? "" : "s"}.`;
  return { key: "discipline", label: "Discipline", earned, max, neutral: false, detail };
}

// ── Narrative ────────────────────────────────────────────────────────────────

function strengthClause(row: AttendanceScoreRow, key: AttScoreComponentKey): string {
  switch (key) {
    case "presence":
      return `strong presence at ${Math.round((attendanceRate(row) ?? 0) * 100)}%`;
    case "punctuality":
      return "consistently on time";
    case "completion":
      return "full days worked through";
    case "discipline":
      return "clean punch discipline";
  }
  return "";
}

function dragClause(row: AttendanceScoreRow, key: AttScoreComponentKey): string {
  const worked = workedDays(row);
  switch (key) {
    case "presence":
      return `presence is low at ${Math.round((attendanceRate(row) ?? 0) * 100)}% (${row.daysAbsent} absent)`;
    case "punctuality":
      return `late beyond the allowance on ${row.alDays} of ${worked} worked days`;
    case "completion":
      return `left early on ${row.earlyOutDays} of ${worked} worked days`;
    case "discipline":
      return `${row.missingPunchDays + row.regRequests} punch issues need attention`;
  }
  return "";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Build the explanation: the highest-scoring component as the strength, the lowest as the drag. */
function buildNarrative(components: AttScoreComponent[], row: AttendanceScoreRow): string {
  const withData = components.filter((c) => !c.neutral);
  if (withData.length === 0) return "Not enough attendance yet to explain this score.";
  const fill = (c: AttScoreComponent) => c.earned / c.max;
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

function bandFor(score: number): AttScoreBand {
  if (score >= 80) return "excellent";
  if (score >= 65) return "solid";
  if (score >= 50) return "developing";
  return "attention";
}

const BAND_LABEL: Record<AttScoreBand, string> = {
  excellent: "Excellent",
  solid: "Solid",
  developing: "Developing",
  attention: "Needs attention",
};

/** Score one employee row into a full {@link AttendanceScore}. Pure. */
export function scoreAttendance(row: AttendanceScoreRow): AttendanceScore {
  const components = [scorePresence(row), scorePunctuality(row), scoreCompletion(row), scoreDiscipline(row)].map(
    (c) => ({ ...c, earned: Math.round(c.earned) }),
  );
  // Sum the rounded components so the displayed parts always add up to the total.
  const score = components.reduce((s, c) => s + c.earned, 0);
  const band = bandFor(score);
  // Rostered = days we could actually assess (paid leave excluded). Too few of
  // them and the score is noise — gate it to "insufficient data".
  const rostered = row.daysPresent + row.daysHalfDay + row.daysAbsent;
  const hasAnyData = rostered + row.daysPaidLeave > 0;
  const scored = rostered >= MIN_ROSTERED_DAYS;
  const narrative = scored
    ? buildNarrative(components, row)
    : hasAnyData
      ? `Only ${rostered} rostered day${rostered === 1 ? "" : "s"} in this window — not enough to score.`
      : "No attendance in this window — not scored.";
  return {
    employeeId: row.employeeId,
    empCode: row.empCode,
    name: row.name,
    designation: row.designation,
    score,
    band,
    bandLabel: BAND_LABEL[band],
    components,
    narrative,
    scored,
    stats: {
      workedDays: workedDays(row),
      present: row.daysPresent,
      halfDay: row.daysHalfDay,
      absent: row.daysAbsent,
      paidLeave: row.daysPaidLeave,
      alDays: row.alDays,
      lceDays: row.lceDays,
      earlyOutDays: row.earlyOutDays,
      missingPunchDays: row.missingPunchDays,
      regRequests: row.regRequests,
      cyclesCovered: row.cyclesCovered,
      attendancePct: attendanceRate(row),
    },
  };
}

/**
 * Build the ranked Attendance Scorecard from a set of employee rows: score each
 * and sort scored employees by score (desc), unscored employees last.
 */
export function buildAttendanceScorecard(rows: AttendanceScoreRow[]): AttendanceScore[] {
  return rows
    .map(scoreAttendance)
    .sort(
      (a, b) =>
        Number(b.scored) - Number(a.scored) ||
        b.score - a.score ||
        a.name.localeCompare(b.name),
    );
}
