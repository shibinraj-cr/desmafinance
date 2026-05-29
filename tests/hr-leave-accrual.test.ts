/**
 * Leave-accrual tests (src/lib/hr-leave-accrual.ts).
 *
 * runMonthlyAccrual credits each eligible employee their monthly allocation
 * inside a transaction, and is meant to be idempotent (a duplicate ledger row
 * is blocked by a unique constraint → that employee is "skipped"). We mock
 * Prisma and assert the skip rules, the credit path (balance create vs bump),
 * and the idempotency handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    hrLeaveEligibility: { findMany: vi.fn() },
    hrAuditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { runMonthlyAccrual, manualAdjustment } from "@/lib/hr-leave-accrual";

const findMany = prisma.hrLeaveEligibility.findMany as unknown as ReturnType<typeof vi.fn>;
const auditCreate = prisma.hrAuditLog.create as unknown as ReturnType<typeof vi.fn>;
const $transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

let txClient: {
  hrLeaveAccrual: { create: ReturnType<typeof vi.fn> };
  hrLeaveBalance: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  hrAuditLog: { create: ReturnType<typeof vi.fn> };
};

function eligibility(over: Record<string, unknown> = {}) {
  return {
    employeeId: "e1",
    leavesPerPeriod: 1.5,
    leaveType: "CL",
    employee: { id: "e1", empCode: "E1", active: true },
    ...over,
  };
}

beforeEach(() => {
  findMany.mockReset();
  auditCreate.mockReset();
  $transaction.mockReset();
  txClient = {
    hrLeaveAccrual: { create: vi.fn() },
    hrLeaveBalance: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    hrAuditLog: { create: vi.fn() },
  };
  $transaction.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient));
});

describe("runMonthlyAccrual — validation", () => {
  it("rejects a periodKey that is not YYYY-MM", async () => {
    await expect(runMonthlyAccrual("2026/03")).rejects.toThrow("periodKey must be YYYY-MM");
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("runMonthlyAccrual — skip rules", () => {
  it("skips inactive employees without opening a transaction", async () => {
    findMany.mockResolvedValueOnce([eligibility({ employee: { id: "e1", empCode: "E1", active: false } })]);

    const res = await runMonthlyAccrual("2026-03");

    expect(res.credited).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.totalDelta).toBe(0);
    expect(res.details[0]).toMatchObject({ status: "skipped", reason: "inactive" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("skips zero-allocation eligibilities", async () => {
    findMany.mockResolvedValueOnce([eligibility({ leavesPerPeriod: 0 })]);

    const res = await runMonthlyAccrual("2026-03");

    expect(res.credited).toBe(0);
    expect(res.details[0]).toMatchObject({ status: "skipped", reason: "zero allocation" });
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("runMonthlyAccrual — credit path", () => {
  it("bumps an existing year balance and writes the ledger row in one transaction", async () => {
    findMany.mockResolvedValueOnce([eligibility()]);
    txClient.hrLeaveBalance.findUnique.mockResolvedValueOnce({ id: "bal1" });

    const res = await runMonthlyAccrual("2026-03");

    expect(res.credited).toBe(1);
    expect(res.skipped).toBe(0);
    expect(res.totalDelta).toBe(1.5);
    expect(res.details[0]).toMatchObject({ status: "credited", delta: 1.5 });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(txClient.hrLeaveAccrual.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeId: "e1", periodKey: "2026-03", delta: 1.5, source: "auto" }),
      }),
    );
    expect(txClient.hrLeaveBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bal1" },
        data: { accrued: { increment: 1.5 }, balance: { increment: 1.5 } },
      }),
    );
    expect(txClient.hrLeaveBalance.create).not.toHaveBeenCalled();
    // A run-level audit row is written at the end.
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh year balance when none exists", async () => {
    findMany.mockResolvedValueOnce([eligibility()]);
    txClient.hrLeaveBalance.findUnique.mockResolvedValueOnce(null);

    await runMonthlyAccrual("2026-03");

    expect(txClient.hrLeaveBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeId: "e1", year: 2026, accrued: 1.5, balance: 1.5, opening: 0, used: 0 }),
      }),
    );
    expect(txClient.hrLeaveBalance.update).not.toHaveBeenCalled();
  });
});

describe("runMonthlyAccrual — idempotency", () => {
  it("treats a unique-constraint failure as 'already accrued' and skips", async () => {
    findMany.mockResolvedValueOnce([eligibility()]);
    // Simulate the duplicate-ledger unique constraint firing inside the tx.
    $transaction.mockImplementationOnce(async () => {
      throw new Error("Unique constraint failed (P2002)");
    });

    const res = await runMonthlyAccrual("2026-03");

    expect(res.credited).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.totalDelta).toBe(0);
    expect(res.details[0]).toMatchObject({ status: "skipped", reason: "already accrued" });
  });
});

describe("manualAdjustment", () => {
  it("rejects a zero delta", async () => {
    await expect(
      manualAdjustment({ employeeId: "e1", delta: 0, reason: "x", actorUserId: "u1" }),
    ).rejects.toThrow("delta cannot be zero");
  });

  it("writes a manual-source ledger row and creates a balance when none exists", async () => {
    txClient.hrLeaveBalance.findUnique.mockResolvedValueOnce(null);

    await manualAdjustment({ employeeId: "e1", delta: 2, reason: "comp off", actorUserId: "u1" });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(txClient.hrLeaveAccrual.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeId: "e1", delta: 2, source: "manual", reason: "comp off" }),
      }),
    );
    expect(txClient.hrLeaveBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ balance: 2, accrued: 2 }) }),
    );
    expect(txClient.hrAuditLog.create).toHaveBeenCalledTimes(1);
  });
});
