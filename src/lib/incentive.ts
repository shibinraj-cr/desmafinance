// BDE Incentive Calculator — shared types, defaults and the pure payout
// engine. Ported from the standalone "Incentive Calculator" tool. The compute
// logic lives here (not in the component) so the server, the client and tests
// all agree on the numbers.

export type DistMethod = "equal" | "enrolments" | "achievers";

export type IncentiveRules = {
  baseRate: number;
  boostThreshold: number;
  boostRate: number;
  individualBonus: number;
  fastBonus: number;
  refBonus: number;
  teamTarget: number;
  teamPool: number;
  distMethod: DistMethod;
  requireMin: boolean;
};

export type IncentiveBdeRow = {
  /** Present once persisted; absent for freshly-added rows. */
  id?: string;
  name: string;
  minimum: number;
  target: number;
  enrol: number;
  fast48: number;
  selfRef: number;
};

export type IncentivePlanData = IncentiveRules & {
  period: string;
  bdes: IncentiveBdeRow[];
};

export const DEFAULT_RULES: IncentiveRules = {
  baseRate: 1000,
  boostThreshold: 16,
  boostRate: 1500,
  individualBonus: 5000,
  fastBonus: 250,
  refBonus: 100,
  teamTarget: 30,
  teamPool: 15000,
  distMethod: "equal",
  requireMin: false,
};

/** Seed roster used when a period has no saved plan yet. */
export const DEFAULT_BDES: IncentiveBdeRow[] = [
  { name: "Sreeshma", minimum: 8, target: 14, enrol: 0, fast48: 0, selfRef: 0 },
  { name: "Athira", minimum: 10, target: 16, enrol: 0, fast48: 0, selfRef: 0 },
  { name: "Shency", minimum: 8, target: 14, enrol: 0, fast48: 0, selfRef: 0 },
];

export type ComputedRow = IncentiveBdeRow & {
  minMet: boolean;
  boost: boolean;
  rate: number;
  gated: boolean;
  enrolPay: number;
  tgtMet: boolean;
  tgtPay: number;
  fastPay: number;
  refPay: number;
  teamShare: number;
  total: number;
};

export type ComputedPlan = {
  rows: ComputedRow[];
  totalEnrol: number;
  teamHit: boolean;
  grand: number;
};

/**
 * The payout engine. Mirrors the original tool exactly:
 *  - boost rate kicks in at/above the threshold,
 *  - enrolment incentive is gated on the minimum only when requireMin is on,
 *  - the team pool is released (and split per distMethod) only when the
 *    combined enrolments meet the team target.
 */
export function computeIncentive(
  rules: IncentiveRules,
  bdes: IncentiveBdeRow[],
): ComputedPlan {
  const totalEnrol = bdes.reduce((s, b) => s + (b.enrol || 0), 0);
  const teamHit = rules.teamTarget > 0 && totalEnrol >= rules.teamTarget;

  const rows: ComputedRow[] = bdes.map((b) => {
    const minMet =
      (b.enrol >= b.minimum && b.minimum > 0) || (b.minimum === 0 && b.enrol > 0);
    const boost = rules.boostThreshold > 0 && b.enrol >= rules.boostThreshold;
    const rate = boost ? rules.boostRate : rules.baseRate;
    const gated = rules.requireMin && b.minimum > 0 && b.enrol < b.minimum;
    const enrolPay = gated ? 0 : b.enrol * rate;
    const tgtMet = b.target > 0 && b.enrol >= b.target;
    const tgtPay = tgtMet ? rules.individualBonus : 0;
    const fastPay = (b.fast48 || 0) * rules.fastBonus;
    const refPay = (b.selfRef || 0) * rules.refBonus;
    return {
      ...b,
      minMet,
      boost,
      rate,
      gated,
      enrolPay,
      tgtMet,
      tgtPay,
      fastPay,
      refPay,
      teamShare: 0,
      total: 0,
    };
  });

  if (teamHit && rules.teamPool > 0) {
    if (rules.distMethod === "equal") {
      const each = rows.length ? rules.teamPool / rows.length : 0;
      rows.forEach((r) => (r.teamShare = each));
    } else if (rules.distMethod === "enrolments") {
      rows.forEach(
        (r) => (r.teamShare = totalEnrol > 0 ? rules.teamPool * (r.enrol / totalEnrol) : 0),
      );
    } else {
      const winners = rows.filter((r) => r.tgtMet);
      if (winners.length) {
        const each = rules.teamPool / winners.length;
        winners.forEach((r) => (r.teamShare = each));
      }
    }
  }

  let grand = 0;
  rows.forEach((r) => {
    r.total = r.enrolPay + r.tgtPay + r.fastPay + r.refPay + r.teamShare;
    grand += r.total;
  });

  return { rows, totalEnrol, teamHit, grand };
}

/**
 * Map a Prisma IncentivePlan (with bdes) into the wire/UI shape. Typed
 * structurally so this stays importable from client code without pulling in
 * @prisma/client types.
 */
export function serializePlan(plan: {
  period: string;
  baseRate: number;
  boostThreshold: number;
  boostRate: number;
  individualBonus: number;
  fastBonus: number;
  refBonus: number;
  teamTarget: number;
  teamPool: number;
  distMethod: string;
  requireMin: boolean;
  bdes: {
    id: string;
    name: string;
    minimum: number;
    target: number;
    enrol: number;
    fast48: number;
    selfRef: number;
    sortIndex: number;
  }[];
}): IncentivePlanData {
  return {
    period: plan.period,
    baseRate: plan.baseRate,
    boostThreshold: plan.boostThreshold,
    boostRate: plan.boostRate,
    individualBonus: plan.individualBonus,
    fastBonus: plan.fastBonus,
    refBonus: plan.refBonus,
    teamTarget: plan.teamTarget,
    teamPool: plan.teamPool,
    distMethod: (["equal", "enrolments", "achievers"].includes(plan.distMethod)
      ? plan.distMethod
      : "equal") as DistMethod,
    requireMin: plan.requireMin,
    bdes: [...plan.bdes]
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map((b) => ({
        id: b.id,
        name: b.name,
        minimum: b.minimum,
        target: b.target,
        enrol: b.enrol,
        fast48: b.fast48,
        selfRef: b.selfRef,
      })),
  };
}

/** Current calendar month as the default period label, e.g. "June 2026". */
export function currentPeriodLabel(now: Date): string {
  return now.toLocaleString("en-US", { month: "long", year: "numeric" });
}
