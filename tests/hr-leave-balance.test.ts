/**
 * Canonical leave-balance engine tests (src/lib/hr-leave-balance.ts).
 *
 * Covers the two behaviours the balance must honour:
 *   1. accrued tracks per-employee eligibility entitlement-to-date, and
 *   2. used reflects full-day paid leave only (LV = 1.0; HD is LOP, not used),
 * with balance = opening + accrued − used.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    hrLeaveEligibility: { findUnique: vi.fn() },
    hrLeaveBalance: { findUnique: vi.fn() },
    hrLeaveAccrual: { findMany: vi.fn() },
    hrAttendanceDay: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  elapsedAccrualMonths,
  accrualMonthsInYear,
  computeLeaveBalanceFor,
  computeMonthlyLeaveLedger,
} from "@/lib/hr-leave-balance";

describe("accrualMonthsInYear", () => {
  const asOf = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15 → current month = June (6)
  it("returns effectiveFrom-month through the current month (mid-year start)", () => {
    expect(accrualMonthsInYear(2026, new Date(Date.UTC(2026, 2, 26)), asOf)).toEqual([3, 4, 5, 6]);
  });
  it("starts at January when eligibility began in a prior year", () => {
    expect(accrualMonthsInYear(2026, new Date(Date.UTC(2025, 5, 1)), asOf)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("covers all 12 months for a fully-elapsed past year", () => {
    expect(accrualMonthsInYear(2025, new Date(Date.UTC(2025, 0, 1)), asOf)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });
  it("returns none for a future year or pre-eligibility year", () => {
    expect(accrualMonthsInYear(2027, new Date(Date.UTC(2026, 0, 1)), asOf)).toEqual([]);
    expect(accrualMonthsInYear(2025, new Date(Date.UTC(2026, 0, 1)), asOf)).toEqual([]);
  });
});

describe("elapsedAccrualMonths", () => {
  const asOf = new Date(Date.UTC(2026, 4, 30)); // 2026-05-30 → current month = May (5)

  it("counts each started month from effectiveFrom through the current month", () => {
    // Effective Jan 2026, as of May 2026 → Jan..May = 5 months.
    expect(elapsedAccrualMonths(2026, new Date(Date.UTC(2026, 0, 1)), asOf)).toBe(5);
  });

  it("starts from the eligibility month when it begins mid-year", () => {
    // Effective Mar 2026 → Mar..May = 3 months.
    expect(elapsedAccrualMonths(2026, new Date(Date.UTC(2026, 2, 15)), asOf)).toBe(3);
  });

  it("returns 0 when eligibility starts after the current month", () => {
    expect(elapsedAccrualMonths(2026, new Date(Date.UTC(2026, 6, 1)), asOf)).toBe(0);
  });

  it("returns 0 for a year before eligibility starts", () => {
    expect(elapsedAccrualMonths(2025, new Date(Date.UTC(2026, 0, 1)), asOf)).toBe(0);
  });

  it("treats a fully elapsed past year as 12 months from January", () => {
    // effectiveFrom in a prior year → counts the whole of 2025 (12).
    expect(elapsedAccrualMonths(2025, new Date(Date.UTC(2024, 5, 1)), asOf)).toBe(12);
  });
});

function makeDb(over: {
  eligibility?: unknown;
  existing?: unknown;
  manualSum?: number | null;
  allocations?: { month: number; value: number }[]; // source 'allocation' rows (year 2026)
  leaveDays?: { status: string; count: number }[];
}) {
  const ledger: { periodKey: string; delta: number; source: string }[] = [];
  if (over.manualSum != null) ledger.push({ periodKey: "2026-01", delta: over.manualSum, source: "manual" });
  for (const a of over.allocations ?? []) {
    ledger.push({ periodKey: `2026-${String(a.month).padStart(2, "0")}`, delta: a.value, source: "allocation" });
  }
  return {
    hrLeaveEligibility: { findUnique: vi.fn().mockResolvedValue(over.eligibility ?? null) },
    hrLeaveBalance: { findUnique: vi.fn().mockResolvedValue(over.existing ?? null) },
    hrLeaveAccrual: {
      findMany: vi.fn().mockResolvedValue(ledger),
    },
    hrAttendanceDay: {
      groupBy: vi
        .fn()
        .mockResolvedValue((over.leaveDays ?? []).map((d) => ({ status: d.status, _count: { _all: d.count } }))),
    },
  } as never;
}

describe("computeLeaveBalanceFor", () => {
  const asOf = new Date(Date.UTC(2026, 4, 30)); // May 2026

  beforeEach(() => vi.clearAllMocks());

  it("derives accrued from eligibility entitlement-to-date", async () => {
    const db = makeDb({
      eligibility: { enabled: true, leavesPerPeriod: 1.5, effectiveFrom: new Date(Date.UTC(2026, 0, 1)) },
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, asOf);
    // 1.5 × 5 months = 7.5 accrued, nothing used.
    expect(c.accrued).toBe(7.5);
    expect(c.used).toBe(0);
    expect(c.balance).toBe(7.5);
  });

  it("counts only full-day paid leave (LV) as used; HD is not charged to balance", async () => {
    const db = makeDb({
      eligibility: { enabled: true, leavesPerPeriod: 1, effectiveFrom: new Date(Date.UTC(2026, 0, 1)) },
      leaveDays: [
        { status: "LV", count: 3 },
        { status: "HD", count: 2 }, // half-days do NOT consume leave balance
      ],
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, asOf);
    expect(c.accrued).toBe(5); // 1 × 5 months
    expect(c.used).toBe(3); // LV only (HD is 0.5-day LOP, not leave used)
    expect(c.balance).toBe(2); // 0 + 5 − 3
  });

  it("folds manual ledger adjustments into accrued and keeps opening", async () => {
    const db = makeDb({
      eligibility: { enabled: true, leavesPerPeriod: 1, effectiveFrom: new Date(Date.UTC(2026, 0, 1)) },
      existing: { opening: 2 },
      manualSum: 1.5,
      leaveDays: [{ status: "LV", count: 1 }],
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, asOf);
    expect(c.opening).toBe(2);
    expect(c.accrued).toBe(6.5); // 5 entitlement + 1.5 manual
    expect(c.used).toBe(1);
    expect(c.balance).toBe(7.5); // 2 + 6.5 − 1
  });

  it("accrues nothing when eligibility is disabled", async () => {
    const db = makeDb({
      eligibility: { enabled: false, leavesPerPeriod: 2, effectiveFrom: new Date(Date.UTC(2026, 0, 1)) },
      leaveDays: [{ status: "LV", count: 1 }],
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, asOf);
    expect(c.accrued).toBe(0);
    expect(c.used).toBe(1);
    expect(c.balance).toBe(-1);
  });

  it("uses HR's monthly allocation override where set, eligibility elsewhere", async () => {
    // Eligibility 1/month, Jan..May elapsed. March overridden to 2.5.
    const db = makeDb({
      eligibility: { enabled: true, leavesPerPeriod: 1, effectiveFrom: new Date(Date.UTC(2026, 0, 1)) },
      allocations: [{ month: 3, value: 2.5 }],
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, asOf);
    // Jan,Feb,Apr,May = 1 each (4) + Mar override 2.5 = 6.5.
    expect(c.accrued).toBe(6.5);
    expect(c.balance).toBe(6.5);
  });

  it("credits an allocation-only month even with no eligibility, ignoring future months", async () => {
    // No eligibility. Feb allocated 3 (elapsed), Aug allocated 5 (future — excluded as of May).
    const db = makeDb({
      allocations: [
        { month: 2, value: 3 },
        { month: 8, value: 5 },
      ],
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, asOf);
    expect(c.accrued).toBe(3);
    expect(c.balance).toBe(3);
  });
});

describe("computeMonthlyLeaveLedger", () => {
  const asOf = new Date(Date.UTC(2026, 4, 15)); // 2026-05-15 → current cycle month = May

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.hrLeaveEligibility.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.hrLeaveBalance.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.hrLeaveAccrual.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.hrAttendanceDay.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it("attributes a late-December leave to the next cycle month and scores HD/A as unpaid", async () => {
    (prisma.hrAttendanceDay.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { date: new Date(Date.UTC(2025, 11, 28)), status: "LV" }, // 28 Dec 2025 → Jan-2026 cycle
      { date: new Date(Date.UTC(2026, 0, 10)), status: "HD" }, // 10 Jan → Jan-2026
      { date: new Date(Date.UTC(2026, 3, 15)), status: "A" }, // 15 Apr → Apr-2026
    ]);
    const { rows } = await computeMonthlyLeaveLedger("e1", 2026, { asOf });
    const jan = rows.find((r) => r.month === 1)!;
    expect(jan.label).toBe("Jan-2026");
    expect(jan.taken).toBe(1); // the 28-Dec LV lands here
    expect(jan.unpaid).toBe(0.5); // the HD
    expect(rows.find((r) => r.month === 4)!.unpaid).toBe(1); // the absence
  });

  it("'full' returns 12 cycle rows; future allocation does not inflate balanceAsOn", async () => {
    (prisma.hrLeaveAccrual.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { periodKey: "2026-02", delta: 2, source: "allocation" }, // Feb (elapsed)
      { periodKey: "2026-08", delta: 5, source: "allocation" }, // Aug (future)
    ]);
    const { rows, balanceAsOn } = await computeMonthlyLeaveLedger("e1", 2026, { asOf, fill: "full" });
    expect(rows).toHaveLength(12);
    expect(rows.find((r) => r.month === 2)!.allocated).toBe(2);
    // balanceAsOn is captured at the current cycle month (May); Aug's 5 comes later.
    expect(balanceAsOn).toBe(2);
    expect(rows.find((r) => r.month === 8)!.balance).toBe(7); // running balance still projects it
  });
});
