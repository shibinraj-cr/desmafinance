/**
 * Canonical leave-balance engine tests (src/lib/hr-leave-balance.ts).
 *
 * Covers:
 *   1. accrued tracks per-employee eligibility entitlement-to-date (by CYCLE month),
 *   2. the monthly paid-leave allocation covers loss-of-pay (A + HD·0.5 + AL·0.5)
 *      earliest-first, with unused balance carried forward, and
 *   3. used = explicit LV + that coverage; balance = opening + accrued − used.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    hrLeaveEligibility: { findUnique: vi.fn() },
    hrLeaveBalance: { findUnique: vi.fn() },
    hrLeaveAccrual: { findMany: vi.fn() },
    hrAttendanceDay: { findMany: vi.fn() },
    employee: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  elapsedAccrualMonths,
  accrualMonthsInYear,
  accrualCycleMonthsInYear,
  cycleMonthLop,
  paidLeaveCoveredByDay,
  computeLeaveBalanceFor,
  computeMonthlyLeaveLedger,
} from "@/lib/hr-leave-balance";

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
// Build a day row for the attendance mocks.
let _id = 0;
const day = (date: Date, status: string, lateMinutes = 0) => ({
  id: `d${_id++}`,
  date,
  status,
  lateMinutes,
});

describe("accrualMonthsInYear (calendar-month basis)", () => {
  const asOf = D(2026, 6, 15);
  it("returns effectiveFrom-month through the current month (mid-year start)", () => {
    expect(accrualMonthsInYear(2026, D(2026, 3, 26), asOf)).toEqual([3, 4, 5, 6]);
  });
  it("starts at January when eligibility began in a prior year", () => {
    expect(accrualMonthsInYear(2026, D(2025, 6, 1), asOf)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("accrualCycleMonthsInYear (salary-cycle basis)", () => {
  const asOf = D(2026, 6, 15); // day 15 → June cycle (6)
  it("counts an on-the-26th effectiveFrom as the NEXT cycle month (26 Mar → April)", () => {
    expect(accrualCycleMonthsInYear(2026, D(2026, 3, 26), asOf)).toEqual([4, 5, 6]);
  });
  it("an effectiveFrom on the 25th stays in that cycle month (25 Mar → March)", () => {
    expect(accrualCycleMonthsInYear(2026, D(2026, 3, 25), asOf)).toEqual([3, 4, 5, 6]);
  });
  it("starts at January when eligibility began in a prior year", () => {
    expect(accrualCycleMonthsInYear(2026, D(2025, 6, 1), asOf)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("returns none for a future / pre-eligibility year", () => {
    expect(accrualCycleMonthsInYear(2027, D(2026, 1, 1), asOf)).toEqual([]);
    expect(accrualCycleMonthsInYear(2025, D(2026, 1, 1), asOf)).toEqual([]);
  });
});

describe("elapsedAccrualMonths", () => {
  const asOf = D(2026, 5, 30);
  it("counts each started month from effectiveFrom through the current month", () => {
    expect(elapsedAccrualMonths(2026, D(2026, 1, 1), asOf)).toBe(5);
  });
  it("returns 0 when eligibility starts after the current month", () => {
    expect(elapsedAccrualMonths(2026, D(2026, 7, 1), asOf)).toBe(0);
  });
});

describe("cycleMonthLop", () => {
  it("sums A (1) + HD (0.5)", () => {
    expect(cycleMonthLop([day(D(2026, 4, 2), "A"), day(D(2026, 4, 3), "HD")], true)).toBe(1.5);
  });
  it("counts a present day late beyond the allowance (AL) as a 0.5 dock", () => {
    // Not LCE-eligible → any late >10min is AL.
    expect(cycleMonthLop([day(D(2026, 4, 2), "P", 40)], false)).toBe(0.5);
  });
  it("does NOT dock an LCE day (eligible, late within 30min, within the 3-day quota)", () => {
    expect(cycleMonthLop([day(D(2026, 4, 2), "P", 20)], true)).toBe(0);
  });
  it("docks the 4th LCE-window late day (quota is 3)", () => {
    const days = [2, 3, 4, 6].map((d) => day(D(2026, 4, d), "P", 20));
    expect(cycleMonthLop(days, true)).toBe(0.5); // first 3 LCE, 4th → AL
  });
  it("ignores late minutes within the 10-min shift grace", () => {
    expect(cycleMonthLop([day(D(2026, 4, 2), "P", 8)], false)).toBe(0);
  });
});

describe("paidLeaveCoveredByDay", () => {
  it("covers the earliest absence first (1 day of coverage → the first A)", () => {
    const a1 = day(D(2026, 4, 2), "A");
    const a2 = day(D(2026, 4, 13), "A");
    const hd = day(D(2026, 4, 20), "HD");
    const m = paidLeaveCoveredByDay([hd, a2, a1], true, 1);
    expect(m.get(a1.id)).toBe(1);
    expect(m.has(a2.id)).toBe(false);
    expect(m.has(hd.id)).toBe(false);
  });
  it("spreads 1 day of coverage across two half-days", () => {
    const hd1 = day(D(2026, 4, 2), "HD");
    const hd2 = day(D(2026, 4, 10), "HD");
    const m = paidLeaveCoveredByDay([hd1, hd2], true, 1);
    expect(m.get(hd1.id)).toBe(0.5);
    expect(m.get(hd2.id)).toBe(0.5);
  });
  it("marks a partially-covered day (0.5 of coverage against a full absence)", () => {
    const a = day(D(2026, 4, 2), "A");
    const m = paidLeaveCoveredByDay([a], true, 0.5);
    expect(m.get(a.id)).toBe(0.5);
  });
  it("counts an AL present-day as a coverable 0.5 loss-of-pay", () => {
    const al = day(D(2026, 4, 2), "P", 40); // not LCE-eligible → AL
    const m = paidLeaveCoveredByDay([al], false, 0.5);
    expect(m.get(al.id)).toBe(0.5);
  });
  it("returns empty when there is no coverage", () => {
    expect(paidLeaveCoveredByDay([day(D(2026, 4, 2), "A")], true, 0).size).toBe(0);
  });
});

function makeDb(over: {
  eligibility?: unknown;
  existing?: unknown;
  manualSum?: number | null;
  allocations?: { month: number; value: number }[];
  days?: ReturnType<typeof day>[];
  eligibleLce?: boolean;
}) {
  const ledger: { periodKey: string; delta: number; source: string }[] = [];
  if (over.manualSum != null) ledger.push({ periodKey: "2026-01", delta: over.manualSum, source: "manual" });
  for (const a of over.allocations ?? []) {
    ledger.push({ periodKey: `2026-${String(a.month).padStart(2, "0")}`, delta: a.value, source: "allocation" });
  }
  return {
    hrLeaveEligibility: { findUnique: vi.fn().mockResolvedValue(over.eligibility ?? null) },
    hrLeaveBalance: { findUnique: vi.fn().mockResolvedValue(over.existing ?? null) },
    hrLeaveAccrual: { findMany: vi.fn().mockResolvedValue(ledger) },
    hrAttendanceDay: { findMany: vi.fn().mockResolvedValue(over.days ?? []) },
    employee: { findUnique: vi.fn().mockResolvedValue({ halfHourConcession: over.eligibleLce ?? false }) },
  } as never;
}

describe("computeLeaveBalanceFor", () => {
  const asOf = D(2026, 5, 15); // May cycle (5)
  beforeEach(() => vi.clearAllMocks());

  it("derives accrued from eligibility entitlement-to-date (no leave)", async () => {
    const db = makeDb({ eligibility: { enabled: true, leavesPerPeriod: 1.5, effectiveFrom: D(2026, 1, 1) } });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, asOf);
    expect(c.accrued).toBe(7.5); // 1.5 × 5 cycle months
    expect(c.used).toBe(0);
    expect(c.balance).toBe(7.5);
  });

  it("the monthly allocation covers loss-of-pay; unused balance carries forward", async () => {
    const db = makeDb({
      eligibility: { enabled: true, leavesPerPeriod: 1, effectiveFrom: D(2026, 1, 1) },
      days: [day(D(2026, 2, 15), "A")], // one absence in the Feb cycle
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, asOf);
    expect(c.accrued).toBe(5); // 1 × 5
    expect(c.used).toBe(1); // the Feb absence covered by paid leave
    expect(c.balance).toBe(4);
  });

  it("caps coverage at the balance available (heavy loss-of-pay)", async () => {
    const db = makeDb({
      eligibility: { enabled: true, leavesPerPeriod: 1, effectiveFrom: D(2026, 1, 1) },
      days: [day(D(2026, 1, 5), "A"), day(D(2026, 1, 8), "A"), day(D(2026, 1, 12), "A")],
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, D(2026, 1, 15)); // Jan cycle only → accrued 1
    expect(c.accrued).toBe(1);
    expect(c.used).toBe(1); // only 1 of the 3 absences covered
    expect(c.balance).toBe(0);
  });

  it("covers HD and AL loss-of-pay the same as absence", async () => {
    const db = makeDb({
      eligibility: { enabled: true, leavesPerPeriod: 1, effectiveFrom: D(2026, 1, 1) },
      eligibleLce: false,
      days: [day(D(2026, 1, 6), "HD"), day(D(2026, 1, 9), "P", 40)], // 0.5 + 0.5 AL = 1.0 LOP
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, D(2026, 1, 15));
    expect(c.used).toBe(1);
    expect(c.balance).toBe(0);
  });

  it("accrues nothing when eligibility is disabled; loss-of-pay stays uncovered", async () => {
    const db = makeDb({
      eligibility: { enabled: false, leavesPerPeriod: 2, effectiveFrom: D(2026, 1, 1) },
      days: [day(D(2026, 1, 6), "A")],
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, D(2026, 1, 15));
    expect(c.accrued).toBe(0);
    expect(c.used).toBe(0);
    expect(c.balance).toBe(0);
  });

  it("folds manual adjustments + opening in, and covers against them", async () => {
    const db = makeDb({
      eligibility: { enabled: true, leavesPerPeriod: 1, effectiveFrom: D(2026, 1, 1) },
      existing: { opening: 2 },
      manualSum: 1.5,
      days: [day(D(2026, 1, 6), "A")],
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, D(2026, 1, 15));
    expect(c.opening).toBe(2);
    expect(c.accrued).toBe(2.5); // 1 entitlement + 1.5 manual
    expect(c.used).toBe(1);
    expect(c.balance).toBe(3.5); // 2 + 2.5 − 1
  });

  it("uses HR's monthly allocation override where set", async () => {
    const db = makeDb({
      eligibility: { enabled: true, leavesPerPeriod: 1, effectiveFrom: D(2026, 1, 1) },
      allocations: [{ month: 3, value: 2.5 }],
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, asOf);
    expect(c.accrued).toBe(6.5); // Jan,Feb,Apr,May = 1 each + Mar 2.5
    expect(c.balance).toBe(6.5);
  });
});

describe("computeMonthlyLeaveLedger", () => {
  const asOf = D(2026, 5, 15); // May cycle
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.hrLeaveEligibility.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.hrLeaveBalance.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.hrLeaveAccrual.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.hrAttendanceDay.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ halfHourConcession: false });
  });

  it("attributes a late-December leave to the next cycle month; scores HD/A as unpaid when no allocation", async () => {
    (prisma.hrAttendanceDay.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      day(D(2025, 12, 28), "LV"), // → Jan-2026 cycle
      day(D(2026, 1, 10), "HD"), // → Jan-2026
      day(D(2026, 4, 15), "A"), // → Apr-2026
    ]);
    const { rows } = await computeMonthlyLeaveLedger("e1", 2026, { asOf });
    const jan = rows.find((r) => r.month === 1)!;
    expect(jan.label).toBe("Jan-2026");
    expect(jan.taken).toBe(1); // the 28-Dec LV
    expect(jan.unpaid).toBe(0.5); // the HD (no allocation → uncovered)
    expect(rows.find((r) => r.month === 4)!.unpaid).toBe(1); // the absence
  });

  it("the monthly allocation covers a cycle's loss-of-pay, capped at the month's balance", async () => {
    // Leave in the FIRST accrual cycle month (Jan) → only 1 day of balance available,
    // so 1 of the 1.5-day LOP is covered and 0.5 stays unpaid.
    (prisma.hrLeaveEligibility.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      leavesPerPeriod: 1,
      effectiveFrom: D(2026, 1, 1),
    });
    (prisma.hrAttendanceDay.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      day(D(2026, 1, 2), "A"),
      day(D(2026, 1, 10), "HD"),
    ]);
    const { rows } = await computeMonthlyLeaveLedger("e1", 2026, { asOf: D(2026, 1, 15), fill: "full" });
    const jan = rows.find((r) => r.month === 1)!;
    expect(jan.allocated).toBe(1);
    expect(jan.covered).toBe(1); // 1 day of the 1.5 LOP covered
    expect(jan.taken).toBe(1); // "Paid taken"
    expect(jan.unpaid).toBe(0.5); // "Unpaid taken" = 1.5 − 1
  });

  it("carries unused allocation forward to cover a later cycle's loss-of-pay", async () => {
    // No leave Jan–Mar (banks 3 days), then 2 days absent in April → all covered.
    (prisma.hrLeaveEligibility.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      leavesPerPeriod: 1,
      effectiveFrom: D(2026, 1, 1),
    });
    (prisma.hrAttendanceDay.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      day(D(2026, 4, 2), "A"),
      day(D(2026, 4, 10), "A"),
    ]);
    const { rows } = await computeMonthlyLeaveLedger("e1", 2026, { asOf, fill: "full" });
    const apr = rows.find((r) => r.month === 4)!;
    expect(apr.covered).toBe(2); // banked Jan–Mar balance covers both absences
    expect(apr.unpaid).toBe(0);
  });

  it("'full' returns 12 cycle rows; a future allocation does not inflate balanceAsOn", async () => {
    (prisma.hrLeaveAccrual.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { periodKey: "2026-02", delta: 2, source: "allocation" },
      { periodKey: "2026-08", delta: 5, source: "allocation" },
    ]);
    const { rows, balanceAsOn } = await computeMonthlyLeaveLedger("e1", 2026, { asOf, fill: "full" });
    expect(rows).toHaveLength(12);
    expect(rows.find((r) => r.month === 2)!.allocated).toBe(2);
    expect(balanceAsOn).toBe(2); // captured at May; Aug's 5 comes later
    expect(rows.find((r) => r.month === 8)!.balance).toBe(7);
  });
});
