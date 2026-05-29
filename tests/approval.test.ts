/**
 * Money-path tests for the approval state machine (src/lib/approval.ts).
 *
 * The behaviour we most care about is ATOMICITY: approving or rejecting a
 * pending change touches 2–3 rows (the ledger Transaction, the PendingApproval,
 * and sometimes a CollectionPlanInstallment), and those writes MUST happen
 * inside a single prisma.$transaction. If they don't, a crash mid-approval can
 * leave a committed Transaction behind a still-"pending" approval that gets
 * approved again → double-posted revenue.
 *
 * We mock the Prisma client. prisma.$transaction(cb) is mocked to invoke the
 * interactive callback with a mock tx client, so asserting that the mutations
 * land on that tx client proves they were wrapped (rather than run as loose
 * top-level prisma.* writes, which is the bug this guards against).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pendingApproval: { findUnique: vi.fn() },
    transaction: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { approvePending, rejectPending } from "@/lib/approval";
import type { Permissions } from "@/lib/rbac";

const findUnique = prisma.pendingApproval.findUnique as unknown as ReturnType<typeof vi.fn>;
const txFindUnique = prisma.transaction.findUnique as unknown as ReturnType<typeof vi.fn>;
const $transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const auditMock = recordAudit as unknown as ReturnType<typeof vi.fn>;

// The mock interactive-transaction client handed to every $transaction(cb) call.
let txClient: {
  transaction: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  pendingApproval: { update: ReturnType<typeof vi.fn> };
  collectionPlanInstallment: { update: ReturnType<typeof vi.fn> };
};

const approver: Permissions = {
  isAdmin: false,
  canApprove: true,
  needsApproval: false,
  draftFirst: false,
  pages: [],
  roleName: "Manager",
};
const nonApprover: Permissions = { ...approver, canApprove: false };

const proposed = {
  date: "2026-05-01",
  month: "May 2026",
  type: "Revenue",
  category: "Services",
  subItem: "Consulting",
  description: "test",
  paymentMode: "Bank",
  amount: 1000,
  flow: "in",
  partyId: "party1",
  expDom: "DOM",
};

// A canonical "before" row for update/delete branches (amount mimics Prisma's Decimal).
const before = {
  id: "tx1",
  deletedAt: null,
  date: new Date("2026-04-01T00:00:00.000Z"),
  month: "Apr 2026",
  type: "Revenue",
  category: "Services",
  subItem: "Consulting",
  description: "old",
  paymentMode: "Bank",
  amount: { toString: () => "500" },
  flow: "in",
};

beforeEach(() => {
  findUnique.mockReset();
  txFindUnique.mockReset();
  $transaction.mockReset();
  auditMock.mockReset();
  txClient = {
    transaction: { create: vi.fn(), update: vi.fn() },
    pendingApproval: { update: vi.fn() },
    collectionPlanInstallment: { update: vi.fn() },
  };
  // Default: run the interactive callback with our mock tx client and return
  // whatever it resolves to (mirrors prisma's interactive-transaction contract).
  $transaction.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient));
});

describe("approvePending — create", () => {
  it("creates the ledger row, resolves the pending, and audits — all inside one transaction", async () => {
    findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "pending",
      kind: "create",
      proposed,
      submittedById: "u1",
      collectionInstallmentId: null,
    });
    txClient.transaction.create.mockResolvedValueOnce({ id: "tx1" });

    const res = await approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver });

    expect(res).toEqual({ applied: true, transactionId: "tx1" });
    // Atomicity: exactly one transaction wraps the writes...
    expect($transaction).toHaveBeenCalledTimes(1);
    // ...and both the ledger write and the pending resolution ran on the tx client.
    expect(txClient.transaction.create).toHaveBeenCalledTimes(1);
    expect(txClient.pendingApproval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ status: "approved", targetTxId: "tx1" }),
      }),
    );
    // Audit is best-effort and runs after the commit.
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("flips a linked collection installment inside the same transaction", async () => {
    findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "pending",
      kind: "create",
      proposed,
      submittedById: "u1",
      collectionInstallmentId: "inst1",
    });
    txClient.transaction.create.mockResolvedValueOnce({ id: "tx1" });

    await approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver });

    expect(txClient.collectionPlanInstallment.update).toHaveBeenCalledWith({
      where: { id: "inst1" },
      data: { status: "received", transactionId: "tx1", pendingApprovalId: null },
    });
  });

  it("aborts without auditing when a write inside the transaction fails (no double-post)", async () => {
    findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "pending",
      kind: "create",
      proposed,
      submittedById: "u1",
      collectionInstallmentId: null,
    });
    txClient.transaction.create.mockResolvedValueOnce({ id: "tx1" });
    // Simulate the pending-resolution failing mid-transaction.
    txClient.pendingApproval.update.mockRejectedValueOnce(new Error("db down"));

    await expect(
      approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver }),
    ).rejects.toThrow("db down");

    // Because the writes share one transaction the failure aborts the whole
    // unit (Postgres rolls back the create), and the post-commit audit never fires.
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe("approvePending — update", () => {
  it("applies the edit and resolves the pending in one transaction", async () => {
    findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "pending",
      kind: "update",
      targetTxId: "tx1",
      proposed,
    });
    txFindUnique.mockResolvedValueOnce(before);
    txClient.transaction.update.mockResolvedValueOnce({ id: "tx1" });

    const res = await approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver });

    expect(res).toEqual({ applied: true, transactionId: "tx1" });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(txClient.transaction.update).toHaveBeenCalledTimes(1);
    expect(txClient.pendingApproval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ status: "approved" }),
      }),
    );
  });

  it("returns target_gone (before opening a transaction) when the target is missing", async () => {
    findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "pending",
      kind: "update",
      targetTxId: "tx1",
      proposed,
    });
    txFindUnique.mockResolvedValueOnce(null);

    const res = await approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver });

    expect(res).toEqual({ error: "target_gone" });
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("approvePending — delete", () => {
  it("soft-deletes the row and resolves the pending in one transaction", async () => {
    findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "pending",
      kind: "delete",
      targetTxId: "tx1",
    });
    txFindUnique.mockResolvedValueOnce(before);

    const res = await approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver });

    expect(res).toEqual({ applied: true, transactionId: "tx1" });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(txClient.transaction.update).toHaveBeenCalledWith({
      where: { id: "tx1" },
      data: expect.objectContaining({ deletedById: "rev1" }),
    });
    expect(txClient.pendingApproval.update).toHaveBeenCalledTimes(1);
  });
});

describe("approvePending — guards", () => {
  it("returns forbidden for non-approvers and never reads or opens a transaction", async () => {
    const res = await approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: nonApprover });

    expect(res).toEqual({ error: "forbidden" });
    expect(findUnique).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("returns not_found when the pending is missing", async () => {
    findUnique.mockResolvedValueOnce(null);

    const res = await approvePending({ pendingId: "missing", reviewerId: "rev1", reviewerPerms: approver });

    expect(res).toEqual({ error: "not_found" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("returns already_resolved when the pending is not pending", async () => {
    findUnique.mockResolvedValueOnce({ id: "p1", status: "approved", kind: "create" });

    const res = await approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver });

    expect(res).toEqual({ error: "already_resolved" });
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("rejectPending", () => {
  it("marks the pending rejected and reverts a linked installment in one transaction", async () => {
    findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "pending",
      kind: "create",
      targetTxId: null,
      collectionInstallmentId: "inst1",
    });

    const res = await rejectPending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver });

    expect(res).toEqual({ rejected: true });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(txClient.pendingApproval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ status: "rejected" }),
      }),
    );
    expect(txClient.collectionPlanInstallment.update).toHaveBeenCalledWith({
      where: { id: "inst1" },
      data: { status: "pending", pendingApprovalId: null },
    });
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("returns forbidden for non-approvers", async () => {
    const res = await rejectPending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: nonApprover });

    expect(res).toEqual({ error: "forbidden" });
    expect($transaction).not.toHaveBeenCalled();
  });
});
