/**
 * Statutory PF rule engine tests (src/lib/hr-pf.ts).
 *
 * Pins the EPFO wage-ceiling revision effective 17 Sep 2026 (₹15,000 →
 * ₹25,000): rule selection by salary-period date, the prorated split of a
 * payroll window that straddles the boundary (DESGRO's 26th→25th cycle means
 * the 2026-09 run crosses it), the employer EPF/EPS split, per-employee
 * contribution bases (ceiling vs actual wages), voluntary PF, and EPFO
 * whole-rupee rounding. PF must always derive from eligible wage × rate —
 * the ₹1,800 / ₹3,000 figures are consequences of the ceiling, never inputs.
 */
import { describe, it, expect } from "vitest";
import {
  computePf,
  pfSegmentsForWindow,
  activePfRule,
  pfRuleStatus,
  LEGACY_PF_RULE,
  type PfRule,
  type PfSegment,
} from "@/lib/hr-pf";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

/** Mirrors the seeded HrPfRule rows (see 20260929100000_pf_statutory_rules). */
const RULE_OLD: PfRule = {
  id: "pf_rule_old_15000",
  code: "PF_RULE_OLD",
  wageCeiling: 15000,
  employeeRatePct: 12,
  employerRatePct: 12,
  epsRatePct: 8.33,
  epsApplicable: true,
  effectiveFrom: d(1952, 11, 1),
  effectiveTo: d(2026, 9, 16),
};
const RULE_2026: PfRule = {
  id: "pf_rule_2026_25000",
  code: "PF_RULE_2026",
  wageCeiling: 25000,
  employeeRatePct: 12,
  employerRatePct: 12,
  epsRatePct: 8.33,
  epsApplicable: true,
  effectiveFrom: d(2026, 9, 17),
  effectiveTo: null,
};
const RULES = [RULE_OLD, RULE_2026];

/** One full-month segment under `rule` (any denominator works; use 30/30). */
const fullMonth = (rule: PfRule): { segments: PfSegment[]; totalDays: number } => ({
  segments: [{ rule, from: d(2026, 1, 1), to: d(2026, 1, 30), days: 30 }],
  totalDays: 30,
});

describe("pfSegmentsForWindow — rule selection by salary-period date", () => {
  it("a window fully inside the old rule resolves to one OLD segment", () => {
    // Aug-2026 cycle: 26 Jul → 25 Aug.
    const { segments, usedFallback } = pfSegmentsForWindow(RULES, d(2026, 7, 26), d(2026, 8, 25));
    expect(usedFallback).toBe(false);
    expect(segments).toHaveLength(1);
    expect(segments[0].rule.code).toBe("PF_RULE_OLD");
    expect(segments[0].days).toBe(31);
  });

  it("the Sep-2026 cycle (26 Aug – 25 Sep) splits at 17 Sep: 22 old days + 9 new days", () => {
    const { segments, usedFallback } = pfSegmentsForWindow(RULES, d(2026, 8, 26), d(2026, 9, 25));
    expect(usedFallback).toBe(false);
    expect(segments).toHaveLength(2);
    expect(segments[0].rule.code).toBe("PF_RULE_OLD");
    expect(segments[0].from.toISOString().slice(0, 10)).toBe("2026-08-26");
    expect(segments[0].to.toISOString().slice(0, 10)).toBe("2026-09-16");
    expect(segments[0].days).toBe(22);
    expect(segments[1].rule.code).toBe("PF_RULE_2026");
    expect(segments[1].from.toISOString().slice(0, 10)).toBe("2026-09-17");
    expect(segments[1].to.toISOString().slice(0, 10)).toBe("2026-09-25");
    expect(segments[1].days).toBe(9);
    expect(segments[0].days + segments[1].days).toBe(31);
  });

  it("a window fully after 17 Sep 2026 resolves to one NEW segment", () => {
    // Oct-2026 cycle: 26 Sep → 25 Oct.
    const { segments, usedFallback } = pfSegmentsForWindow(RULES, d(2026, 9, 26), d(2026, 10, 25));
    expect(usedFallback).toBe(false);
    expect(segments).toHaveLength(1);
    expect(segments[0].rule.code).toBe("PF_RULE_2026");
    expect(segments[0].days).toBe(30);
  });

  it("falls back to the built-in legacy rule when no rules exist", () => {
    const { segments, usedFallback } = pfSegmentsForWindow([], d(2026, 8, 26), d(2026, 9, 25));
    expect(usedFallback).toBe(true);
    expect(segments).toHaveLength(1);
    expect(segments[0].rule.code).toBe(LEGACY_PF_RULE.code);
    expect(segments[0].days).toBe(31);
  });

  it("fills a coverage gap between rules with the legacy fallback", () => {
    const gappy: PfRule[] = [
      { ...RULE_OLD, effectiveTo: d(2026, 8, 31) }, // gap 1–16 Sep
      RULE_2026,
    ];
    const { segments, usedFallback } = pfSegmentsForWindow(gappy, d(2026, 8, 26), d(2026, 9, 25));
    expect(usedFallback).toBe(true);
    expect(segments.map((s) => s.rule.code)).toEqual([
      "PF_RULE_OLD",
      LEGACY_PF_RULE.code,
      "PF_RULE_2026",
    ]);
    expect(segments.map((s) => s.days)).toEqual([6, 16, 9]);
  });
});

describe("computePf — full months before 17 Sep 2026 (₹15,000 ceiling)", () => {
  it("wage ₹12,000 (below ceiling): PF on ₹12,000 → ₹1,440", () => {
    const c = computePf({ monthlyPfWage: 12000, basis: "ceiling", ...fullMonth(RULE_OLD) });
    expect(c.pfWage).toBe(12000);
    expect(c.employeePf).toBe(1440);
    expect(c.employerTotal).toBe(1440);
    expect(c.ceilingApplied).toBe(false);
  });

  it("wage ₹15,000: employee PF exactly ₹1,800; EPS 8.33% of ₹15,000, EPF the remainder", () => {
    const c = computePf({ monthlyPfWage: 15000, basis: "ceiling", ...fullMonth(RULE_OLD) });
    expect(c.employeePf).toBe(1800);
    expect(c.employerTotal).toBe(1800);
    expect(c.employerEps).toBe(1250); // round(15000 × 8.33%)
    expect(c.employerEpf).toBe(550); // total − EPS, never the whole 12% to EPF
    expect(c.employerEpf + c.employerEps).toBe(c.employerTotal);
  });

  it("wage ₹20,000: ceiling caps the PF wage at ₹15,000 → ₹1,800", () => {
    const c = computePf({ monthlyPfWage: 20000, basis: "ceiling", ...fullMonth(RULE_OLD) });
    expect(c.pfWage).toBe(15000);
    expect(c.employeePf).toBe(1800);
    expect(c.ceilingApplied).toBe(true);
  });
});

describe("computePf — full months from 17 Sep 2026 (₹25,000 ceiling)", () => {
  it("wage ₹12,000: unchanged — PF still on ₹12,000", () => {
    const c = computePf({ monthlyPfWage: 12000, basis: "ceiling", ...fullMonth(RULE_2026) });
    expect(c.pfWage).toBe(12000);
    expect(c.employeePf).toBe(1440);
  });

  it("wage ₹20,000: now below the ceiling — PF on the full ₹20,000 → ₹2,400", () => {
    const c = computePf({ monthlyPfWage: 20000, basis: "ceiling", ...fullMonth(RULE_2026) });
    expect(c.pfWage).toBe(20000);
    expect(c.employeePf).toBe(2400);
    expect(c.employerTotal).toBe(2400);
    expect(c.ceilingApplied).toBe(false);
  });

  it("wage ₹25,000: employee PF ₹3,000 (the new maximum standard contribution)", () => {
    const c = computePf({ monthlyPfWage: 25000, basis: "ceiling", ...fullMonth(RULE_2026) });
    expect(c.pfWage).toBe(25000);
    expect(c.employeePf).toBe(3000);
  });

  it("wage ₹30,000 on the statutory-ceiling basis: PF wage ₹25,000, employee PF ₹3,000", () => {
    const c = computePf({ monthlyPfWage: 30000, basis: "ceiling", ...fullMonth(RULE_2026) });
    expect(c.pfWage).toBe(25000);
    expect(c.employeePf).toBe(3000);
    expect(c.employerTotal).toBe(3000);
    expect(c.employerEps).toBe(2083); // round(25000 × 8.33%)
    expect(c.employerEpf).toBe(917);
    expect(c.ceilingApplied).toBe(true);
  });

  it("wage ₹30,000 already contributing on ACTUAL wages: preserved, never reduced to ₹3,000", () => {
    const c = computePf({ monthlyPfWage: 30000, basis: "actual", ...fullMonth(RULE_2026) });
    expect(c.pfWage).toBe(30000);
    expect(c.employeePf).toBe(3600); // 12% × 30,000 — higher-wage config kept
    expect(c.employerTotal).toBe(3600);
    // EPS stays capped at the statutory ceiling even on the actual basis.
    expect(c.employerEps).toBe(2083);
    expect(c.employerEpf).toBe(1517);
    expect(c.ceilingApplied).toBe(false);
    expect(c.basisApplied).toBe("actual");
  });

  it("voluntary PF adds an employee-only extra on the eligible wage", () => {
    const c = computePf({
      monthlyPfWage: 20000,
      basis: "ceiling",
      voluntaryPct: 5,
      ...fullMonth(RULE_2026),
    });
    expect(c.employeePf).toBe(2400);
    expect(c.employeeVpf).toBe(1000); // 5% × 20,000
    expect(c.employeeTotal).toBe(3400);
    expect(c.employerTotal).toBe(2400); // employer never matches VPF
  });
});

describe("computePf — September 2026 transition month (split calculation)", () => {
  // DESGRO's September payroll period is the 26 Aug – 25 Sep cycle (31 days):
  // 22 days under the ₹15,000 rule, 9 days under the ₹25,000 rule. Both
  // slices are prorated by calendar days and combine into ONE month's PF.
  const sepWindow = () => {
    const { segments } = pfSegmentsForWindow(RULES, d(2026, 8, 26), d(2026, 9, 25));
    return { segments, totalDays: 31 };
  };

  it("wage ₹30,000: both prorated ceilings bind; slices combine into one PF record", () => {
    const c = computePf({ monthlyPfWage: 30000, basis: "ceiling", ...sepWindow() });
    // old slice: min(30000, 15000) × 22/31 ; new slice: min(30000, 25000) × 9/31
    const oldWage = (15000 * 22) / 31;
    const newWage = (25000 * 9) / 31;
    expect(c.pfWage).toBeCloseTo(oldWage + newWage, 2); // 17,903.23
    expect(c.employeePf).toBe(Math.round((oldWage + newWage) * 0.12)); // 2,148
    expect(c.employeePf).toBe(2148);
    expect(c.employerTotal).toBe(2148);
    expect(c.employerEps).toBe(1491); // round(8.33% × combined capped wage)
    expect(c.employerEpf).toBe(657);
    expect(c.segments).toHaveLength(2);
    expect(c.segments[0]).toMatchObject({
      ruleCode: "PF_RULE_OLD",
      from: "2026-08-26",
      to: "2026-09-16",
      days: 22,
      wageCeiling: 15000,
    });
    expect(c.segments[0].pfWage).toBeCloseTo(oldWage, 2);
    expect(c.segments[1]).toMatchObject({
      ruleCode: "PF_RULE_2026",
      from: "2026-09-17",
      to: "2026-09-25",
      days: 9,
      wageCeiling: 25000,
    });
    expect(c.segments[1].pfWage).toBeCloseTo(newWage, 2);
  });

  it("wage ₹20,000: old slice is ceiling-capped, new slice is not", () => {
    const c = computePf({ monthlyPfWage: 20000, basis: "ceiling", ...sepWindow() });
    const oldWage = (15000 * 22) / 31; // capped: 20000×22/31 > 15000×22/31
    const newWage = (20000 * 9) / 31; // uncapped: below 25000×9/31
    expect(c.pfWage).toBeCloseTo(oldWage + newWage, 2);
    expect(c.employeePf).toBe(Math.round((oldWage + newWage) * 0.12)); // 1,974
    expect(c.ceilingApplied).toBe(true);
  });

  it("wage ₹12,000: no ceiling binds in either slice → same as an unsplit month", () => {
    const c = computePf({ monthlyPfWage: 12000, basis: "ceiling", ...sepWindow() });
    expect(c.pfWage).toBeCloseTo(12000, 2);
    expect(c.employeePf).toBe(1440);
    expect(c.ceilingApplied).toBe(false);
  });

  it("actual-wage member ₹30,000: uncapped in both slices, EPS still ceiling-capped", () => {
    const c = computePf({ monthlyPfWage: 30000, basis: "actual", ...sepWindow() });
    expect(c.pfWage).toBeCloseTo(30000, 2);
    expect(c.employeePf).toBe(3600);
    const cappedCombined = (15000 * 22) / 31 + (25000 * 9) / 31;
    expect(c.employerEps).toBe(Math.round(cappedCombined * 0.0833));
    expect(c.employerEpf + c.employerEps).toBe(c.employerTotal);
  });
});

describe("computePf — edge behaviour", () => {
  it("zero wage / no segments → all zeroes", () => {
    expect(computePf({ monthlyPfWage: 0, basis: "ceiling", ...fullMonth(RULE_2026) }).employeeTotal).toBe(0);
    expect(computePf({ monthlyPfWage: 20000, basis: "ceiling", segments: [], totalDays: 0 }).employeeTotal).toBe(0);
  });

  it("EPS off on the rule sends the whole employer contribution to EPF", () => {
    const noEps: PfRule = { ...RULE_2026, epsApplicable: false };
    const c = computePf({ monthlyPfWage: 20000, basis: "ceiling", ...fullMonth(noEps) });
    expect(c.employerEps).toBe(0);
    expect(c.employerEpf).toBe(2400);
  });

  it("member-level EPS exemption (Employee.epsExempt) reallocates EPS to EPF, totals unchanged", () => {
    const base = computePf({ monthlyPfWage: 14000, basis: "ceiling", ...fullMonth(RULE_OLD) });
    const exempt = computePf({
      monthlyPfWage: 14000,
      basis: "ceiling",
      ...fullMonth(RULE_OLD),
      epsApplicable: false,
    });
    expect(base.employerEps).toBe(1166); // 8.33% of 14,000
    expect(exempt.employerEps).toBe(0);
    expect(exempt.employerEpf).toBe(base.employerTotal);
    expect(exempt.employerTotal).toBe(base.employerTotal);
    expect(exempt.employeeTotal).toBe(base.employeeTotal);
  });
});

describe("activePfRule / pfRuleStatus", () => {
  it("selects the rule in force on a date", () => {
    expect(activePfRule(RULES, d(2026, 9, 16))?.code).toBe("PF_RULE_OLD");
    expect(activePfRule(RULES, d(2026, 9, 17))?.code).toBe("PF_RULE_2026");
    expect(activePfRule([], d(2026, 9, 17))).toBeNull();
  });

  it("labels rules relative to today", () => {
    const today = d(2026, 9, 29);
    expect(pfRuleStatus(RULE_OLD, today)).toBe("superseded");
    expect(pfRuleStatus(RULE_2026, today)).toBe("active");
    expect(pfRuleStatus({ ...RULE_2026, effectiveFrom: d(2027, 4, 1) }, today)).toBe("scheduled");
  });
});
