/**
 * Payroll math tests (src/lib/hr-salary-engine.ts).
 *
 * These are the pure salary-calculation functions — the code that decides how
 * much money lands in each employee's account. Worth pinning down precisely:
 * the allowance split, the Kerala PT slab, the ESI eligibility ceiling, the
 * statutory PF wage cap, and the loss-of-pay (LOP) arithmetic for absences,
 * half-days, and paid leave covered (or not) by a carried balance.
 *
 * computeSalaryRun() is DB-coupled and covered separately; here we test the
 * pure engine with no mocking.
 */
import { describe, it, expect } from "vitest";

// hr-salary-engine imports the Prisma client at module load; stub it so no
// PrismaClient is instantiated for these pure-function tests.
import { vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  deriveBreakdown,
  suggestProfessionalTax,
  isEsiApplicable,
  isTraineeDesignation,
  bucketAttendance,
  calcLine,
  DEFAULT_ALLOWANCE_PCTS,
  ESI_EMPLOYEE_RATE,
  ESI_EMPLOYER_RATE,
  PF_RATE,
  PF_CONTRIBUTION_CAP,
  TRAINEE_DESIGNATION_NAME,
} from "@/lib/hr-salary-engine";

describe("deriveBreakdown", () => {
  it("defaults the allowance split to 40/20/25/15 → gross = basic × 2", () => {
    const b = deriveBreakdown(10000);
    expect(b).toEqual({
      basic: 10000,
      hra: 4000,
      conveyance: 2000,
      medical: 2500,
      special: 1500,
      gross: 20000,
    });
    // Sanity: the default pcts sum to 100% of basic.
    const sumPct =
      DEFAULT_ALLOWANCE_PCTS.hra +
      DEFAULT_ALLOWANCE_PCTS.conveyance +
      DEFAULT_ALLOWANCE_PCTS.medical +
      DEFAULT_ALLOWANCE_PCTS.special;
    expect(sumPct).toBe(100);
  });

  it("honours custom percentages (50/25/35/40 → gross = basic × 2.5)", () => {
    const b = deriveBreakdown(10000, { hraPct: 50, conveyancePct: 25, medicalPct: 35, specialPct: 40 });
    expect(b.hra).toBe(5000);
    expect(b.conveyance).toBe(2500);
    expect(b.medical).toBe(3500);
    expect(b.special).toBe(4000);
    expect(b.gross).toBe(25000);
  });
});

describe("isTraineeDesignation", () => {
  it("matches 'Trainee' case-insensitively and trimmed", () => {
    expect(isTraineeDesignation("Trainee")).toBe(true);
    expect(isTraineeDesignation("trainee")).toBe(true);
    expect(isTraineeDesignation("  TRAINEE  ")).toBe(true);
  });
  it("does not match other designations or empty values", () => {
    expect(isTraineeDesignation("Executive")).toBe(false);
    expect(isTraineeDesignation("Sr. Trainee")).toBe(false); // exact name only
    expect(isTraineeDesignation(null)).toBe(false);
    expect(isTraineeDesignation(undefined)).toBe(false);
    expect(isTraineeDesignation("")).toBe(false);
  });
  it("exposes the canonical name constant", () => {
    expect(TRAINEE_DESIGNATION_NAME).toBe("Trainee");
  });
});

describe("calcLine — trainee override (basic only)", () => {
  // Mirrors exactly the args computeSalaryRun passes for a trainee: allowance
  // pcts 0, ESI/PF off, PT 0. The saved structure had basic 10000 and would
  // normally carry allowances + ESI + PF + PT, all of which must be suppressed.
  it("full attendance: gross = basic, no ESI/PF/PT, net = basic", () => {
    const c = calcLine({
      workingDaysBase: 30,
      basic: 10000,
      hraPct: 0,
      conveyancePct: 0,
      medicalPct: 0,
      specialPct: 0,
      esiApplicable: false,
      pfApplicable: false,
      professionalTax: 0,
      daysPresent: 30,
      daysHalfDay: 0,
      daysAbsent: 0,
      daysPaidLeave: 0,
      carriedBalanceBefore: 0,
    });
    expect(c.gross).toBe(10000);
    expect(c.hra).toBe(0);
    expect(c.conveyance).toBe(0);
    expect(c.medical).toBe(0);
    expect(c.special).toBe(0);
    expect(c.salaryBeforeEsi).toBe(10000);
    expect(c.esiEmployee).toBe(0);
    expect(c.esiEmployer).toBe(0);
    expect(c.pfEmployee).toBe(0);
    expect(c.pfEmployer).toBe(0);
    expect(c.professionalTax).toBe(0);
    expect(c.netSalary).toBe(10000);
  });

  it("prorates basic for LOP exactly as a normal line would", () => {
    // 5 unpaid absent days out of 30. gross = basic = 10000,
    // dailyBasis = 10000/30, salaryBeforeEsi = 10000 − (10000/30)*5.
    const c = calcLine({
      workingDaysBase: 30,
      basic: 10000,
      hraPct: 0,
      conveyancePct: 0,
      medicalPct: 0,
      specialPct: 0,
      esiApplicable: false,
      pfApplicable: false,
      professionalTax: 0,
      daysPresent: 25,
      daysHalfDay: 0,
      daysAbsent: 5,
      daysPaidLeave: 0,
      carriedBalanceBefore: 0,
    });
    expect(c.gross).toBe(10000);
    expect(c.totalLeaveForLop).toBe(5);
    expect(c.salaryBeforeEsi).toBeCloseTo(8333.35, 2);
    expect(c.netSalary).toBe(8333); // round(8333.35 − 0 − 0 − 0)
  });
});

describe("suggestProfessionalTax (Kerala half-yearly slab, per month)", () => {
  it("returns 125 below the ₹100k half-yearly slab", () => {
    expect(suggestProfessionalTax(10000)).toBe(125); // 60k/half-year
  });
  it("returns 167 in the 100k–124,999 half-yearly slab", () => {
    expect(suggestProfessionalTax(18000)).toBe(167); // 108k/half-year
    expect(suggestProfessionalTax(16667)).toBe(167); // 100,002 — just over the boundary
  });
  it("returns 208 at or above the 125k half-yearly slab", () => {
    expect(suggestProfessionalTax(30000)).toBe(208); // 180k/half-year
  });
  it("treats the 100k boundary by strict >= on the half-yearly figure", () => {
    expect(suggestProfessionalTax(16666)).toBe(125); // 99,996 — just under
  });
});

describe("isEsiApplicable", () => {
  it("applies at or below the ₹21,000 gross ceiling", () => {
    expect(isEsiApplicable(21000)).toBe(true);
    expect(isEsiApplicable(15000)).toBe(true);
  });
  it("does not apply above the ceiling", () => {
    expect(isEsiApplicable(21001)).toBe(false);
  });
});

describe("bucketAttendance", () => {
  it("counts P/OD/REG as present, A as absent, HD as half, LV as paid leave; ignores unknown", () => {
    const buckets = bucketAttendance(
      [
        { status: "P" },
        { status: "OD" },
        { status: "REG" },
        { status: "P" },
        { status: "A" },
        { status: "HD" },
        { status: "HD" },
        { status: "LV" },
        { status: "WO" }, // weekly off / unknown — ignored
      ],
    );
    expect(buckets).toEqual({ daysPresent: 4, daysAbsent: 1, daysHalfDay: 2, daysPaidLeave: 1 });
  });
});

describe("calcLine", () => {
  const base = {
    workingDaysBase: 30,
    basic: 10000, // default split → gross 20000
    esiApplicable: true,
    pfApplicable: true,
    professionalTax: 125,
    daysHalfDay: 0,
    daysAbsent: 0,
    daysPaidLeave: 0,
    carriedBalanceBefore: 0,
  };

  it("full-attendance month: no LOP, ESI on both sides, PF below the cap", () => {
    const c = calcLine({ ...base, daysPresent: 30 });
    expect(c.gross).toBe(20000);
    expect(c.dailyBasis).toBeCloseTo(666.67, 2);
    expect(c.daysAttended).toBe(30);
    expect(c.totalLeaveForLop).toBe(0);
    expect(c.basicAfterLop).toBe(10000);
    expect(c.salaryBeforeEsi).toBe(20000);
    // ESI employee 0.75%, employer 3.75% (DESMA's rate).
    expect(c.esiEmployee).toBe(150);
    expect(c.esiEmployer).toBe(750);
    expect(c.esiEmployee).toBe(Math.round(20000 * ESI_EMPLOYEE_RATE));
    expect(c.esiEmployer).toBe(Math.round(20000 * ESI_EMPLOYER_RATE));
    // PF 12% of basic-after-LOP (10000 < 15000 cap).
    expect(c.pfEmployee).toBe(1200);
    expect(c.pfEmployer).toBe(1200);
    expect(c.netSalary).toBe(18525); // 20000 − 150 − 1200 − 125
  });

  it("unpaid absence drives LOP, and PF is capped at the ₹15,000 wage ceiling", () => {
    // basic 20000 → gross 40000 (> 21000, so ESI does not apply).
    const c = calcLine({
      ...base,
      basic: 20000,
      esiApplicable: false,
      professionalTax: 208,
      daysPresent: 25,
      daysAbsent: 5,
    });
    expect(c.gross).toBe(40000);
    expect(c.daysAttended).toBe(25);
    expect(c.totalLeaveForLop).toBe(5);
    expect(c.salaryBeforeEsi).toBeCloseTo(33333.35, 2);
    expect(c.esiEmployee).toBe(0);
    expect(c.esiEmployer).toBe(0);
    // basicAfterLop = 16666.67 > 15000 → PF capped at 1800 each side.
    expect(c.pfEmployee).toBe(1800);
    expect(c.pfEmployer).toBe(1800);
    expect(c.pfEmployee).toBe(Math.round(PF_CONTRIBUTION_CAP));
    expect(c.netSalary).toBe(31325); // 33333.35 − 0 − 1800 − 208 → round
  });

  it("paid leave fully covered by the carried balance: no LOP", () => {
    const c = calcLine({
      ...base,
      daysPresent: 20,
      daysPaidLeave: 5,
      carriedBalanceBefore: 10, // covers all 5
    });
    expect(c.daysAttended).toBe(30); // paid days = base − LOP (0 LOP); PF on full basic
    expect(c.totalLeaveForLop).toBe(0);
    expect(c.unpaidLeave).toBe(0);
    expect(c.paidLeave).toBe(5);
    expect(c.salaryBeforeEsi).toBe(20000); // no deduction
    expect(c.netSalary).toBe(18525); // 20000 − 150 − 1200 − 125 (PF on full basic)
  });

  it("paid leave only partly covered: the uncovered remainder becomes LOP", () => {
    const c = calcLine({
      ...base,
      daysPresent: 20,
      daysPaidLeave: 5,
      carriedBalanceBefore: 2, // covers 2, leaves 3 unpaid
    });
    expect(c.daysAttended).toBe(27); // paid days = base − 3 LOP
    expect(c.totalLeaveForLop).toBe(3); // 3 uncovered
    expect(c.unpaidLeave).toBe(3);
    expect(c.salaryBeforeEsi).toBeCloseTo(17999.99, 2);
    expect(c.netSalary).toBe(16660); // 17999.99 − 135 − 1080 (PF on 27/30) − 125 → round
  });

  it("half-days count as 0.5 attended and 0.5 LOP", () => {
    const c = calcLine({ ...base, daysPresent: 28, daysHalfDay: 2 });
    expect(c.halfDayLeave).toBe(2);
    expect(c.daysAttended).toBe(29); // 28 + 2×0.5
    expect(c.totalLeaveForLop).toBe(1); // 2×0.5
    expect(c.salaryBeforeEsi).toBeCloseTo(19333.33, 2);
  });

  it("Greeshma K X, April 2026: PF accrues on paid days (base − LOP), not present-count", () => {
    // Regression for the Apr-2026 line that showed net ₹24,001 in the UI.
    // Her attendance import was short ~6 present rows, so the old engine
    // summed only 22.5 present days and accrued PF on 22.5/30 of basic —
    // while paying salary for 28.5 days. Paid days must be base − LOP = 28.5.
    const c = calcLine({
      workingDaysBase: 30,
      basic: 13375, // default 40/20/25/15 split → gross 26750
      esiApplicable: false, // gross 26750 > ₹21k ceiling → no ESI
      pfApplicable: true,
      professionalTax: 208, // Kerala top slab
      daysPresent: 21, // incomplete import — intentionally irrelevant now
      daysHalfDay: 1, // 20 Apr
      daysAbsent: 1, // 13 Apr
      daysPaidLeave: 1, // covered by the carried balance below → not LOP
      carriedBalanceBefore: 1,
    });
    expect(c.gross).toBe(26750);
    expect(c.totalLeaveForLop).toBe(1.5); // 1 absent + 0.5 half-day
    expect(c.daysAttended).toBe(28.5); // base − LOP, NOT the 22.5 present-count
    expect(c.basicAfterLop).toBe(12706.25); // 13375 × 28.5/30
    expect(c.esiEmployee).toBe(0);
    expect(c.pfEmployee).toBe(1525); // 12% × 12706.25, whole-rupee rounded
    expect(c.salaryBeforeEsi).toBe(25412.5);
    // Net ₹23,680 — matches HR's April sheet (₹23,680.25) to the rupee; the
    // 25-paise gap is the engine's whole-rupee rounding of PF, not the LOP bug.
    expect(c.netSalary).toBe(23680);
  });

  it("zeroes ESI and PF when neither is applicable", () => {
    const c = calcLine({ ...base, daysPresent: 30, esiApplicable: false, pfApplicable: false });
    expect(c.esiEmployee).toBe(0);
    expect(c.esiEmployer).toBe(0);
    expect(c.pfEmployee).toBe(0);
    expect(c.pfEmployer).toBe(0);
    expect(c.netSalary).toBe(19875); // 20000 − 0 − 0 − 125
  });

  it("exposes the documented statutory constants", () => {
    expect(ESI_EMPLOYEE_RATE).toBe(0.0075);
    expect(ESI_EMPLOYER_RATE).toBe(0.0375);
    expect(PF_RATE).toBe(0.12);
    expect(PF_CONTRIBUTION_CAP).toBe(1800);
  });
});
