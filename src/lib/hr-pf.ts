/**
 * Statutory Provident Fund calculation (EPFO) — pure, Prisma-free.
 *
 * PF is governed by EFFECTIVE-DATED statutory rules (HrPfRule rows): each rule
 * carries a wage ceiling, contribution rates and an [effectiveFrom, effectiveTo]
 * validity window. The payroll engine selects rules by the SALARY-PERIOD DATE,
 * never a single global ceiling, so:
 *
 *   - historical runs recomputed today still use the rule that was in force
 *     for their period (₹15,000 through 16 Sep 2026);
 *   - a payroll period that STRADDLES a rule boundary — DESGRO's cycle is the
 *     26th → 25th, so the 17 Sep 2026 ceiling change lands mid-way through the
 *     2026-09 run (26 Aug – 25 Sep) — is split into per-rule segments, each
 *     prorated by its calendar days, then combined into one month's PF;
 *   - a future EPFO amendment is a new HrPfRule row, not a code change.
 *
 * Proration follows DESGRO's existing methodology: the month's PF-applicable
 * wage (basic after loss-of-pay) is apportioned to each segment by
 * calendar-day fraction of the cycle, and each segment's ceiling is prorated
 * by the same fraction:
 *
 *   segment PF wage = monthly PF wage × segment days / cycle days,
 *                     capped at (ceiling × segment days / cycle days)
 *
 * (LOP is tracked as a monthly aggregate, not per-date, so day-fractions of
 * the LOP-reduced wage are the faithful reading of "payable days / period
 * days" here.)
 *
 * Employer split: EPS takes epsRatePct (statutorily 8.33%) of the PF wage
 * capped at the statutory ceiling — ALWAYS ceiling-capped, even for members
 * contributing on actual wages above the ceiling — and EPF receives the
 * remainder of the employer contribution. The whole employer 12% is never
 * credited to EPF alone while EPS applies.
 *
 * Rounding (EPFO/ECR practice): contributions are rounded to the nearest
 * rupee at the MONTH level (after summing segments); employer EPF is derived
 * as (rounded employer total − rounded EPS) so the sides always reconcile.
 *
 * Contribution basis (per employee, HrSalaryStructure.pfBasis):
 *   "ceiling" — statutory-ceiling contribution (the default).
 *   "actual"  — contribute on actual PF wages above the ceiling (existing
 *               higher-wage members). A ceiling change never auto-reduces
 *               these employees; EPS stays ceiling-capped.
 * Voluntary PF (pfVoluntaryPct) is an EXTRA employee-only % on the same
 * eligible wage, on top of the statutory employee rate — no employer match.
 */

export type PfBasis = "ceiling" | "actual";

export const PF_BASIS_LABELS: Record<PfBasis, string> = {
  ceiling: "Statutory ceiling",
  actual: "Actual PF wages",
};

/** An effective-dated statutory PF rule (mirrors the HrPfRule model). */
export type PfRule = {
  id: string | null;
  code: string;
  /** Statutory PF wage ceiling, ₹/month. */
  wageCeiling: number;
  /** Employee contribution % of eligible PF wages. */
  employeeRatePct: number;
  /** Employer total (EPF+EPS) contribution % of eligible PF wages. */
  employerRatePct: number;
  /** Slice of the employer side diverted to EPS, % of the ceiling-capped wage. */
  epsRatePct: number;
  epsApplicable: boolean;
  /** Date-only UTC. */
  effectiveFrom: Date;
  /** Date-only UTC; null = open-ended (currently active). */
  effectiveTo: Date | null;
};

/**
 * Built-in fallback matching the engine's historical hard-coded behaviour
 * (₹15,000 ceiling, 12% both sides). Used only when no HrPfRule row covers a
 * day of the payroll window — e.g. a deploy racing the seed migration — so
 * payroll never computes PF with no rule at all. computeSalaryRun surfaces a
 * warning whenever this is applied.
 */
export const LEGACY_PF_RULE: PfRule = {
  id: null,
  code: "PF_LEGACY_15000",
  wageCeiling: 15000,
  employeeRatePct: 12,
  employerRatePct: 12,
  epsRatePct: 8.33,
  epsApplicable: true,
  effectiveFrom: new Date(Date.UTC(1952, 10, 1)), // EPF scheme inception
  effectiveTo: null,
};

/** One slice of a payroll window governed by a single PF rule. */
export type PfSegment = {
  rule: PfRule;
  /** Inclusive date-only UTC bounds. */
  from: Date;
  to: Date;
  /** Calendar days in [from, to]. */
  days: number;
};

const DAY = 86_400_000;

const round = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Inclusive calendar days between two date-only UTC dates. */
function daysInclusive(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY) + 1;
}

/**
 * Split the payroll window [start, end] (inclusive, date-only UTC) into
 * per-rule segments, selecting each rule by the dates it was in force.
 * Rules must not overlap; any day no rule covers falls back to
 * LEGACY_PF_RULE and is reported via `usedFallback`.
 */
export function pfSegmentsForWindow(
  rules: PfRule[],
  start: Date,
  end: Date,
): { segments: PfSegment[]; usedFallback: boolean } {
  const sorted = [...rules].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  );
  const segments: PfSegment[] = [];
  let usedFallback = false;
  let cursor = start.getTime();
  const endMs = end.getTime();

  const push = (rule: PfRule, fromMs: number, toMs: number) => {
    const from = new Date(fromMs);
    const to = new Date(toMs);
    segments.push({ rule, from, to, days: daysInclusive(from, to) });
  };

  while (cursor <= endMs) {
    const covering = sorted.find(
      (r) =>
        r.effectiveFrom.getTime() <= cursor &&
        (r.effectiveTo === null || r.effectiveTo.getTime() >= cursor),
    );
    if (covering) {
      const to = Math.min(endMs, covering.effectiveTo?.getTime() ?? endMs);
      push(covering, cursor, to);
      cursor = to + DAY;
    } else {
      // Gap: fall back until the next rule starts (or the window ends).
      usedFallback = true;
      const nextStart = sorted
        .map((r) => r.effectiveFrom.getTime())
        .filter((t) => t > cursor)
        .sort((a, b) => a - b)[0];
      const to = Math.min(endMs, nextStart !== undefined ? nextStart - DAY : endMs);
      push(LEGACY_PF_RULE, cursor, to);
      cursor = to + DAY;
    }
  }
  return { segments, usedFallback };
}

/** Per-segment audit detail — frozen onto the payroll line as JSON. */
export type PfSegmentCalc = {
  ruleId: string | null;
  ruleCode: string;
  /** ISO yyyy-mm-dd, inclusive. */
  from: string;
  to: string;
  days: number;
  /** Full-month statutory ceiling of the rule (₹/month, unprorated). */
  wageCeiling: number;
  /** Ceiling prorated to this segment's day fraction. */
  proratedCeiling: number;
  /** Monthly PF wage apportioned to this segment (before the ceiling). */
  segmentWage: number;
  /** Eligible PF wage after applying the basis / prorated ceiling. */
  pfWage: number;
  employeePf: number;
  employerEpf: number;
  employerEps: number;
  employeeRatePct: number;
  employerRatePct: number;
  epsRatePct: number;
};

export type PfCalc = {
  /** Total eligible PF wage across segments (the "PF Applicable Wage"). */
  pfWage: number;
  /** Statutory employee contribution (whole rupees), excluding VPF. */
  employeePf: number;
  /** Voluntary extra employee contribution (whole rupees). */
  employeeVpf: number;
  /** employeePf + employeeVpf — what payroll deducts. */
  employeeTotal: number;
  employerEpf: number;
  employerEps: number;
  /** employerEpf + employerEps. */
  employerTotal: number;
  basisApplied: PfBasis;
  /** True when the statutory ceiling actually capped any segment's wage. */
  ceilingApplied: boolean;
  segments: PfSegmentCalc[];
};

export const ZERO_PF: PfCalc = {
  pfWage: 0,
  employeePf: 0,
  employeeVpf: 0,
  employeeTotal: 0,
  employerEpf: 0,
  employerEps: 0,
  employerTotal: 0,
  basisApplied: "ceiling",
  ceilingApplied: false,
  segments: [],
};

/**
 * Compute one month's PF from the month's PF-applicable wage and the rule
 * segments covering its payroll window.
 *
 * PF contribution is ALWAYS eligible wage × rate — the familiar ₹1,800 /
 * ₹3,000 figures are consequences of the ceiling, never hard-coded amounts.
 */
export function computePf(args: {
  /** The month's PF-applicable wage (basic after loss-of-pay), ₹. */
  monthlyPfWage: number;
  basis: PfBasis;
  /** Extra employee-only VPF % of the eligible wage (no employer match). */
  voluntaryPct?: number | null;
  segments: PfSegment[];
  /** Total calendar days of the payroll window (Σ segment days). */
  totalDays: number;
}): PfCalc {
  const wage = Math.max(0, args.monthlyPfWage);
  if (wage === 0 || args.segments.length === 0 || args.totalDays <= 0) {
    return { ...ZERO_PF, basisApplied: args.basis, segments: [] };
  }

  let eligibleSum = 0;
  let eeSum = 0;
  let erSum = 0;
  let epsSum = 0;
  let ceilingApplied = false;
  const segments: PfSegmentCalc[] = [];

  for (const seg of args.segments) {
    const r = seg.rule;
    const frac = seg.days / args.totalDays;
    const segmentWage = wage * frac;
    const proratedCeiling = r.wageCeiling * frac;
    const capped = Math.min(segmentWage, proratedCeiling);
    const eligible = args.basis === "actual" ? segmentWage : capped;
    if (eligible < segmentWage) ceilingApplied = true;

    const ee = (eligible * r.employeeRatePct) / 100;
    const erTotal = (eligible * r.employerRatePct) / 100;
    // EPS is computed on the CEILING-CAPPED wage even for actual-basis
    // members (the statutory EPS wage never exceeds the ceiling); it can
    // never exceed the employer total.
    const eps = r.epsApplicable ? Math.min((capped * r.epsRatePct) / 100, erTotal) : 0;

    eligibleSum += eligible;
    eeSum += ee;
    erSum += erTotal;
    epsSum += eps;

    segments.push({
      ruleId: r.id,
      ruleCode: r.code,
      from: seg.from.toISOString().slice(0, 10),
      to: seg.to.toISOString().slice(0, 10),
      days: seg.days,
      wageCeiling: r.wageCeiling,
      proratedCeiling: round2(proratedCeiling),
      segmentWage: round2(segmentWage),
      pfWage: round2(eligible),
      employeePf: round2(ee),
      employerEpf: round2(erTotal - eps),
      employerEps: round2(eps),
      employeeRatePct: r.employeeRatePct,
      employerRatePct: r.employerRatePct,
      epsRatePct: r.epsRatePct,
    });
  }

  // Month-level EPFO rounding: nearest rupee per contribution; employer EPF
  // derived from the rounded total so EPF + EPS always equals the total.
  const pfWage = round2(eligibleSum);
  const employeePf = round(eeSum);
  const employerTotal = round(erSum);
  const employerEps = Math.min(round(epsSum), employerTotal);
  const employerEpf = employerTotal - employerEps;
  const vpfPct = args.voluntaryPct ?? 0;
  const employeeVpf = vpfPct > 0 ? round((pfWage * vpfPct) / 100) : 0;

  return {
    pfWage,
    employeePf,
    employeeVpf,
    employeeTotal: employeePf + employeeVpf,
    employerEpf,
    employerEps,
    employerTotal,
    basisApplied: args.basis,
    ceilingApplied,
    segments,
  };
}

/** Rule in force on a given date (for settings display / previews). */
export function activePfRule(rules: PfRule[], on: Date): PfRule | null {
  const t = Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate());
  return (
    rules.find(
      (r) =>
        r.effectiveFrom.getTime() <= t &&
        (r.effectiveTo === null || r.effectiveTo.getTime() >= t),
    ) ?? null
  );
}

/** Display status of a rule relative to today: active / superseded / scheduled. */
export function pfRuleStatus(rule: PfRule, today: Date): "active" | "superseded" | "scheduled" {
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (rule.effectiveFrom.getTime() > t) return "scheduled";
  if (rule.effectiveTo !== null && rule.effectiveTo.getTime() < t) return "superseded";
  return "active";
}

/** Shape a Prisma HrPfRule row (Decimal fields) into the pure PfRule type. */
export function toPfRule(row: {
  id: string;
  code: string;
  wageCeiling: unknown;
  employeeRatePct: unknown;
  employerRatePct: unknown;
  epsRatePct: unknown;
  epsApplicable: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}): PfRule {
  return {
    id: row.id,
    code: row.code,
    wageCeiling: Number(row.wageCeiling),
    employeeRatePct: Number(row.employeeRatePct),
    employerRatePct: Number(row.employerRatePct),
    epsRatePct: Number(row.epsRatePct),
    epsApplicable: row.epsApplicable,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}
