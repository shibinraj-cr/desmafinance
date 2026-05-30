/**
 * Canonical leave-balance engine tests (src/lib/hr-leave-balance.ts).
 *
 * Covers the two behaviours the balance must honour:
 *   1. accrued tracks per-employee eligibility entitlement-to-date, and
 *   2. used reflects reviewed & decided leave (LV = 1.0, HD = 0.5),
 * with balance = opening + accrued − used.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { elapsedAccrualMonths, computeLeaveBalanceFor } from "@/lib/hr-leave-balance";

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
  leaveDays?: { status: string; count: number }[];
}) {
  return {
    hrLeaveEligibility: { findUnique: vi.fn().mockResolvedValue(over.eligibility ?? null) },
    hrLeaveBalance: { findUnique: vi.fn().mockResolvedValue(over.existing ?? null) },
    hrLeaveAccrual: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { delta: over.manualSum ?? null } }),
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

  it("counts reviewed & decided leave as used: LV = 1.0, HD = 0.5", async () => {
    const db = makeDb({
      eligibility: { enabled: true, leavesPerPeriod: 1, effectiveFrom: new Date(Date.UTC(2026, 0, 1)) },
      leaveDays: [
        { status: "LV", count: 3 },
        { status: "HD", count: 2 },
      ],
    });
    const c = await computeLeaveBalanceFor(db, "e1", 2026, asOf);
    expect(c.accrued).toBe(5); // 1 × 5 months
    expect(c.used).toBe(4); // 3×1.0 + 2×0.5
    expect(c.balance).toBe(1); // 0 + 5 − 4
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
});
