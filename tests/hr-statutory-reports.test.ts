/**
 * Monthly PF (ECR) / ESI return derivation tests (src/lib/hr-statutory-reports.ts).
 *
 * Pins the two line generations the reports must serve:
 *   - LEGACY lines (computed before the PF statutory-rules feature): PF audit
 *     columns at zero defaults, pfDetail null — the EPF/EPS split is derived
 *     from basicAfterLop + stored totals under the ₹15,000 / 8.33% maths those
 *     lines used (verified against the accepted August-2026 upload figures);
 *   - NEW lines: the frozen audit columns pass through untouched.
 * Plus the EPS-exempt reallocation, which must also apply to frozen lines.
 */
import { describe, it, expect } from "vitest";
import {
  deriveEcrRow,
  deriveEsiRow,
  formatDays,
  monthLabel,
  type StatutoryLineInput,
} from "@/lib/hr-statutory-reports";

const line = (over: Partial<StatutoryLineInput>): StatutoryLineInput => ({
  employeeId: "emp1",
  empCode: "E001",
  name: "TEST MEMBER",
  uan: "100000000001",
  esiIpNumber: "4800000001",
  epsExempt: false,
  salaryBeforeEsi: 0,
  basicAfterLop: 0,
  daysAttended: 30,
  totalLeaveForLop: 0,
  pfEmployee: 0,
  pfEmployer: 0,
  pfWage: 0,
  pfEmployerEpf: 0,
  pfEmployerEps: 0,
  pfDetail: null,
  ...over,
});

describe("deriveEcrRow — legacy lines (pfDetail null, audit columns at defaults)", () => {
  it("rebuilds the 12% / 8.33% split from basicAfterLop (2 NCP days case)", () => {
    // Accepted Aug-2026 figures: gross 28,233 · EPF wage 14,116.5 →
    // EE 1,694 · EPS 1,176 · EPF diff 518.
    const r = deriveEcrRow(
      line({
        salaryBeforeEsi: 28233,
        basicAfterLop: 14116.5,
        totalLeaveForLop: 2,
        pfEmployee: 1694,
        pfEmployer: 1694,
      }),
    );
    expect(r.grossWages).toBe(28233);
    expect(r.epfWages).toBe(14116.5);
    expect(r.epsWage).toBe(14116.5);
    expect(r.edliWages).toBe(14116.5);
    expect(r.epfContribution).toBe(1694);
    expect(r.epsContribution).toBe(1176);
    expect(r.epfEpsDifference).toBe(518);
    expect(r.ncpDays).toBe(2);
    expect(r.refundOfAdvances).toBe(0);
  });

  it("caps the PF/EPS/EDLI wages at the legacy ₹15,000 ceiling for high earners", () => {
    // Accepted Aug-2026 figures: EPF wage 15,000 → EE 1,800 · EPS 1,250 · diff 550.
    const r = deriveEcrRow(
      line({
        salaryBeforeEsi: 150000,
        basicAfterLop: 75000,
        pfEmployee: 1800,
        pfEmployer: 1800,
      }),
    );
    expect(r.epfWages).toBe(15000);
    expect(r.epsWage).toBe(15000);
    expect(r.edliWages).toBe(15000);
    expect(r.epfContribution).toBe(1800);
    expect(r.epsContribution).toBe(1250);
    expect(r.epfEpsDifference).toBe(550);
  });

  it("EPS-exempt member: whole employer share in the EPF-diff column, EPS wage 0", () => {
    // Accepted Aug-2026 figures for the non-EPS member: EPS wage 0 · EPS 0 ·
    // diff 1,073 (the full employer 12%).
    const r = deriveEcrRow(
      line({
        epsExempt: true,
        salaryBeforeEsi: 17888,
        basicAfterLop: 8944,
        totalLeaveForLop: 4,
        pfEmployee: 1073,
        pfEmployer: 1073,
      }),
    );
    expect(r.epfWages).toBe(8944);
    expect(r.epsWage).toBe(0);
    expect(r.edliWages).toBe(8944);
    expect(r.epsContribution).toBe(0);
    expect(r.epfEpsDifference).toBe(1073);
  });

  it("an all-LOP month files a zero row with 30 NCP days", () => {
    const r = deriveEcrRow(line({ totalLeaveForLop: 30, daysAttended: 0 }));
    expect(r.grossWages).toBe(0);
    expect(r.epfWages).toBe(0);
    expect(r.epsContribution).toBe(0);
    expect(r.epfEpsDifference).toBe(0);
    expect(r.ncpDays).toBe(30);
  });
});

describe("deriveEcrRow — new lines (frozen audit columns)", () => {
  const newLine = (over: Partial<StatutoryLineInput>) =>
    line({
      salaryBeforeEsi: 18683,
      basicAfterLop: 9341.5,
      totalLeaveForLop: 0.5,
      pfEmployee: 1121,
      pfEmployer: 1121,
      pfWage: 9341.5,
      pfEmployerEpf: 343,
      pfEmployerEps: 778,
      pfDetail: { segments: [{ segmentWage: 9341.5, proratedCeiling: 15000 }] },
      ...over,
    });

  it("passes the stored split through untouched", () => {
    const r = deriveEcrRow(newLine({}));
    expect(r.epfWages).toBe(9341.5);
    expect(r.epsWage).toBe(9341.5);
    expect(r.epfContribution).toBe(1121);
    expect(r.epsContribution).toBe(778);
    expect(r.epfEpsDifference).toBe(343);
    expect(r.ncpDays).toBe(0.5);
  });

  it("EPS wage is the ceiling-capped slice for actual-basis members (per frozen segment)", () => {
    // Actual-basis wage above the ceiling: EPS wage caps per segment while
    // EPF wages carry the full eligible wage.
    const r = deriveEcrRow(
      newLine({
        pfWage: 30000,
        pfEmployerEpf: 2350,
        pfEmployerEps: 1250,
        pfDetail: { segments: [{ segmentWage: 30000, proratedCeiling: 15000 }] },
      }),
    );
    expect(r.epfWages).toBe(30000);
    expect(r.epsWage).toBe(15000);
    expect(r.edliWages).toBe(15000);
  });

  it("EPS-exempt reallocation also applies to lines frozen before the flag was set", () => {
    const r = deriveEcrRow(newLine({ epsExempt: true }));
    expect(r.epsWage).toBe(0);
    expect(r.epsContribution).toBe(0);
    expect(r.epfEpsDifference).toBe(1121);
  });
});

describe("deriveEsiRow", () => {
  it("carries paid days and whole-rupee wages", () => {
    const r = deriveEsiRow(
      line({ daysAttended: 27, totalLeaveForLop: 3, salaryBeforeEsi: 17888.4 }),
    );
    expect(r.daysPaid).toBe(27);
    expect(r.monthlyWages).toBe(17888);
    expect(r.zeroDays).toBe(false);
  });

  it("flags zero-wage months so HR can add the reason code + LWD", () => {
    const r = deriveEsiRow(line({ daysAttended: 0, totalLeaveForLop: 30, salaryBeforeEsi: 0 }));
    expect(r.daysPaid).toBe(0);
    expect(r.monthlyWages).toBe(0);
    expect(r.zeroDays).toBe(true);
  });
});

describe("formatting helpers", () => {
  it("formats day counts the way the upload sheets carry them", () => {
    expect(formatDays(27)).toBe("27");
    expect(formatDays(29.5)).toBe("29.5");
    expect(formatDays(0)).toBe("0");
  });

  it("labels months for filenames and page copy", () => {
    expect(monthLabel("2026-08")).toBe("August 2026");
  });
});
