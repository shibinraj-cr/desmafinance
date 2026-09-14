/**
 * Paid vs unpaid half-day leave.
 *
 * A half-day used to be one thing only: 0.5 day of loss-of-pay that the monthly
 * allocation absorbed if the balance happened to reach it. HR can now rule on
 * it the same way they rule on a full day — paid (charged to the leave balance,
 * like LV) or unpaid (docked, like A).
 *
 * This is a MONEY path, so the cases that matter are: a paid half-day is not
 * docked twice, an unpaid one still is, and a row with no ruling (`halfPaid`
 * null — every half-day written before this existed) behaves exactly as it
 * always did.
 */
import { describe, it, expect } from "vitest";
import { calcLine, bucketAttendance, leaveUsedInYear } from "@/lib/hr-salary-engine";
import { cycleMonthLop, paidLeaveCoveredByDay, isPaidHalfDay, explicitPaidLeave } from "@/lib/hr-leave-balance";

/** ₹30,000 over a 30-day base → ₹1,000 a day, so pay reads as days directly. */
const line = (over: Partial<Parameters<typeof calcLine>[0]> = {}) =>
  calcLine({
    workingDaysBase: 30,
    basic: 30000,
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
    ...over,
  });

let seq = 0;
const day = (date: string, status: string, over: { halfPaid?: boolean | null; late?: number } = {}) => ({
  id: `d${seq++}`,
  date: new Date(`${date}T00:00:00Z`),
  status,
  lateMinutes: over.late ?? 0,
  halfPaid: over.halfPaid ?? null,
});

describe("isPaidHalfDay", () => {
  it("is true only for an HD explicitly ruled paid", () => {
    expect(isPaidHalfDay({ status: "HD", halfPaid: true })).toBe(true);
    expect(isPaidHalfDay({ status: "HD", halfPaid: false })).toBe(false);
    expect(isPaidHalfDay({ status: "HD", halfPaid: null })).toBe(false);
    expect(isPaidHalfDay({ status: "HD" })).toBe(false);
    // A full-day paid leave is LV, not a paid half-day.
    expect(isPaidHalfDay({ status: "LV", halfPaid: true })).toBe(false);
  });
});

describe("calcLine — a paid half-day is charged to the balance, not docked", () => {
  it("costs nothing when the leave balance covers it", () => {
    const c = line({ daysHalfDay: 1, daysHalfDayPaid: 1, carriedBalanceBefore: 5 });
    expect(c.totalLeaveForLop).toBe(0);
    expect(c.netSalary).toBe(30000);
    // Still reported as a half-day on the slip — that's what happened.
    expect(c.halfDayLeave).toBe(1);
    expect(c.paidLeave).toBe(0.5);
  });

  it("docks an UNPAID half-day the usual 0.5 day", () => {
    const c = line({ daysHalfDay: 1, daysHalfDayPaid: 0, carriedBalanceBefore: 5 });
    expect(c.totalLeaveForLop).toBe(0.5);
    expect(c.netSalary).toBe(29500);
  });

  it("never docks a paid half-day twice", () => {
    // Regression guard: the paid half must come OUT of the half-day LOP term,
    // not just get added to the paid-leave one.
    const both = line({ daysHalfDay: 2, daysHalfDayPaid: 1, carriedBalanceBefore: 5 });
    expect(both.totalLeaveForLop).toBe(0.5); // only the unpaid half-day is docked
    expect(both.halfDayLeave).toBe(2);
  });

  it("falls back to loss-of-pay when the balance can't cover it", () => {
    // Same rule an over-drawn full-day LV already follows.
    const c = line({ daysHalfDay: 1, daysHalfDayPaid: 1, carriedBalanceBefore: 0 });
    expect(c.totalLeaveForLop).toBe(0.5);
    expect(c.netSalary).toBe(29500);
  });

  it("shares one balance between a full-day LV and a paid half-day", () => {
    // 1 day of balance, 1 LV (1.0) + 1 paid half-day (0.5) = 1.5 claimed.
    const c = line({ daysPaidLeave: 1, daysHalfDay: 1, daysHalfDayPaid: 1, carriedBalanceBefore: 1 });
    expect(c.totalLeaveForLop).toBe(0.5); // the uncovered 0.5 falls to LOP
  });

  it("leaves every existing figure untouched when no half-day is paid", () => {
    // daysHalfDayPaid defaults to 0, so pre-existing callers are unaffected.
    const before = line({ daysHalfDay: 3, daysAbsent: 2, daysPaidLeave: 1, carriedBalanceBefore: 1 });
    const after = line({
      daysHalfDay: 3,
      daysHalfDayPaid: 0,
      daysAbsent: 2,
      daysPaidLeave: 1,
      carriedBalanceBefore: 1,
    });
    expect(after).toEqual(before);
    expect(before.totalLeaveForLop).toBe(3.5); // 2 absent + 3 × 0.5
  });

  it("ignores a paid count larger than the half-day count", () => {
    // Defensive: a miscounted caller must not manufacture negative loss-of-pay.
    const c = line({ daysHalfDay: 1, daysHalfDayPaid: 4, carriedBalanceBefore: 10 });
    expect(c.totalLeaveForLop).toBe(0);
    expect(c.paidLeave).toBe(0.5);
  });
});

describe("leaveUsedInYear", () => {
  it("counts a paid half-day as 0.5 and a full-day LV as 1", () => {
    const days = [
      day("2026-09-01", "LV"),
      day("2026-09-02", "HD", { halfPaid: true }),
      day("2026-09-03", "HD", { halfPaid: false }),
      day("2026-09-04", "HD"),
    ];
    expect(leaveUsedInYear(days, 2026)).toBe(1.5);
  });

  it("still ignores days outside the year", () => {
    const days = [day("2025-12-30", "HD", { halfPaid: true }), day("2026-01-02", "LV")];
    expect(leaveUsedInYear(days, 2026)).toBe(1);
  });
});

describe("ledger — cycleMonthLop", () => {
  it("excludes a paid half-day from loss-of-pay", () => {
    const days = [day("2026-09-01", "HD", { halfPaid: true }), day("2026-09-02", "A")];
    expect(cycleMonthLop(days, false)).toBe(1);
  });

  it("still counts an unpaid and an undecided half-day", () => {
    const days = [day("2026-09-01", "HD", { halfPaid: false }), day("2026-09-02", "HD")];
    expect(cycleMonthLop(days, false)).toBe(1);
  });
});

describe("ledger — paidLeaveCoveredByDay", () => {
  it("does not spend the allocation on a half-day already granted as paid", () => {
    // The paid half-day is charged to the balance elsewhere; if the coverage
    // pass also picked it up, the same 0.5 would be deducted twice.
    const paidHalf = day("2026-09-01", "HD", { halfPaid: true });
    const absence = day("2026-09-02", "A");
    const covered = paidLeaveCoveredByDay([paidHalf, absence], false, 1);
    expect(covered.has(paidHalf.id)).toBe(false);
    expect(covered.get(absence.id)).toBe(1);
  });
});

describe("explicitPaidLeave", () => {
  it("sums LV at 1 and paid half-days at 0.5", () => {
    expect(
      explicitPaidLeave([
        { status: "LV" },
        { status: "HD", halfPaid: true },
        { status: "HD", halfPaid: true },
        { status: "HD", halfPaid: false },
        { status: "A" },
      ]),
    ).toBe(2);
  });
});

describe("bucketAttendance feeds calcLine consistently", () => {
  it("a cycle with one paid and one unpaid half-day docks exactly 0.5", () => {
    const attendance = [
      { status: "HD", halfPaid: true },
      { status: "HD", halfPaid: false },
      ...Array.from({ length: 28 }, () => ({ status: "P" })),
    ];
    const b = bucketAttendance(attendance);
    const c = line({
      daysPresent: b.daysPresent,
      daysHalfDay: b.daysHalfDay,
      daysHalfDayPaid: b.daysHalfDayPaid,
      daysAbsent: b.daysAbsent,
      daysPaidLeave: b.daysPaidLeave,
      carriedBalanceBefore: 5,
    });
    expect(c.totalLeaveForLop).toBe(0.5);
    expect(c.netSalary).toBe(29500);
  });
});
