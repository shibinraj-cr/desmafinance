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
  $queryRaw: ReturnType<typeof vi.fn>;
  transaction: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  pendingApproval: { update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  collectionPlanInstallment: {
    update: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  invoice: { findFirst: ReturnType<typeof vi.fn> };
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
    // The row lock (SELECT … FOR NO KEY UPDATE) and the invoice check that guard every ledger edit.
    $queryRaw: vi.fn().mockResolvedValue([]),
    transaction: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ ...before, partyId: "party1", expDom: "DOM" }),
      // The candidate's ledger, searched for a UTR already booked.
      findMany: vi.fn().mockResolvedValue([]),
    },
    // The in-transaction claim succeeds unless a test says another reviewer won.
    pendingApproval: { update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    // findFirst: is the ledger row a payment recorded on a plan? Not unless a test says so.
    collectionPlanInstallment: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    invoice: { findFirst: vi.fn().mockResolvedValue(null) },
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
    // ...the pending is claimed (only while still pending) on the tx client...
    expect(txClient.pendingApproval.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: "pending" },
      data: expect.objectContaining({ status: "approved", reviewedById: "rev1" }),
    });
    // ...and the ledger write and its link ran on the same tx client.
    expect(txClient.transaction.create).toHaveBeenCalledTimes(1);
    expect(txClient.pendingApproval.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { targetTxId: "tx1" },
    });
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

    txClient.collectionPlanInstallment.findUnique.mockResolvedValueOnce({ planId: "plan1" });
    txClient.collectionPlanInstallment.findMany.mockResolvedValue([
      { id: "inst1", seq: 2, expectedDate: new Date("2026-05-01T00:00:00.000Z"), amount: { toString: () => "1000" }, status: "submitted" },
    ]);

    await approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver });

    // The plan's rows are locked, then the instalment is received for what was paid.
    expect(txClient.$queryRaw).toHaveBeenCalled();
    expect(txClient.collectionPlanInstallment.update).toHaveBeenCalledWith({
      where: { id: "inst1" },
      data: { status: "received", amount: 1000, transactionId: "tx1", pendingApprovalId: null },
    });
  });

  it("splits off the rest of a part-paid instalment in the same transaction", async () => {
    findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "pending",
      kind: "create",
      proposed: { ...proposed, amount: 600 },
      submittedById: "u1",
      collectionInstallmentId: "inst1",
    });
    txClient.transaction.create.mockResolvedValueOnce({ id: "tx1" });
    txClient.collectionPlanInstallment.findUnique.mockResolvedValueOnce({ planId: "plan1" });
    txClient.collectionPlanInstallment.findMany.mockResolvedValue([
      { id: "inst1", seq: 2, expectedDate: new Date("2026-05-01T00:00:00.000Z"), amount: { toString: () => "1000" }, status: "submitted", category: "C", subItem: "S", paymentMode: "HDFC Bank", description: null },
    ]);

    const res = await approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver });

    expect(res).toEqual({ applied: true, transactionId: "tx1" });
    expect(txClient.collectionPlanInstallment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ planId: "plan1", seq: 3, amount: 400, status: "pending", description: "Rest of instalment 2" }),
    });
    expect(txClient.collectionPlanInstallment.update).toHaveBeenCalledWith({
      where: { id: "inst1" },
      data: { status: "received", amount: 600, transactionId: "tx1", pendingApprovalId: null },
    });
  });

  it("posts nothing when the plan can no longer take the payment", async () => {
    findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "pending",
      kind: "create",
      proposed: { ...proposed, amount: 5000 },
      submittedById: "u1",
      collectionInstallmentId: "inst1",
    });
    txClient.transaction.create.mockResolvedValueOnce({ id: "tx1" });
    txClient.collectionPlanInstallment.findUnique.mockResolvedValueOnce({ planId: "plan1" });
    txClient.collectionPlanInstallment.findMany.mockResolvedValue([
      { id: "inst1", seq: 2, expectedDate: new Date("2026-05-01T00:00:00.000Z"), amount: { toString: () => "1000" }, status: "submitted" },
    ]);

    const res = await approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver });

    // The throw rolls the whole transaction back (claim and ledger row included).
    expect(res).toEqual({ error: "collection_more_than_due" });
    expect(txClient.collectionPlanInstallment.update).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
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
    expect(txClient.pendingApproval.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: "pending" },
      data: expect.objectContaining({ status: "approved" }),
    });
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
    expect(txClient.pendingApproval.updateMany).toHaveBeenCalledTimes(1);
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
    expect(txClient.pendingApproval.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: "pending" },
      data: expect.objectContaining({ status: "rejected" }),
    });
    // Only while the instalment is still waiting on THIS entry.
    expect(txClient.collectionPlanInstallment.updateMany).toHaveBeenCalledWith({
      where: { id: "inst1", status: "submitted", pendingApprovalId: "p1" },
      data: { status: "pending", pendingApprovalId: null },
    });
    expect(txClient.collectionPlanInstallment.update).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("returns forbidden for non-approvers", async () => {
    const res = await rejectPending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: nonApprover });

    expect(res).toEqual({ error: "forbidden" });
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("approvePending — a GST invoice freezes the ledger row", () => {
  it("refuses an edit that changes what an issued invoice printed, and leaves the pending open", async () => {
    findUnique.mockResolvedValueOnce({ id: "p2", status: "pending", kind: "update", targetTxId: "tx1", proposed });
    txFindUnique.mockResolvedValueOnce(before);
    txClient.invoice.findFirst.mockResolvedValueOnce({ number: "D/DIPL/26-27/0001" });

    const res = await approvePending({ pendingId: "p2", reviewerId: "mgr", reviewerPerms: approver });

    expect(res).toEqual({ error: "invoiced" });
    expect(txClient.$queryRaw).toHaveBeenCalledTimes(1);
    expect(txClient.transaction.update).not.toHaveBeenCalled();
    // The claim ran inside the transaction the guard then aborted, so in the
    // database it rolls back and the pending stays open for a reject.
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("refuses a delete of an invoiced row", async () => {
    findUnique.mockResolvedValueOnce({ id: "p3", status: "pending", kind: "delete", targetTxId: "tx1", proposed: null });
    txFindUnique.mockResolvedValueOnce(before);
    txClient.invoice.findFirst.mockResolvedValueOnce({ number: "D/DIPL/26-27/0001" });

    const res = await approvePending({ pendingId: "p3", reviewerId: "mgr", reviewerPerms: approver });

    expect(res).toEqual({ error: "invoiced" });
    expect(txClient.transaction.update).not.toHaveBeenCalled();
  });

  it("allows an edit that leaves every printed field as it was", async () => {
    const same = { ...proposed, date: "2026-04-01", amount: 500, paymentMode: "Bank", expDom: "DOM", description: "new words" };
    findUnique.mockResolvedValueOnce({ id: "p4", status: "pending", kind: "update", targetTxId: "tx1", proposed: same });
    txFindUnique.mockResolvedValueOnce(before);
    txClient.invoice.findFirst.mockResolvedValueOnce({ number: "D/DIPL/26-27/0001" });
    txClient.transaction.update.mockResolvedValueOnce({ id: "tx1" });

    const res = await approvePending({ pendingId: "p4", reviewerId: "mgr", reviewerPerms: approver });

    expect(res).toMatchObject({ applied: true, transactionId: "tx1" });
    expect(txClient.transaction.update).toHaveBeenCalledTimes(1);
  });
});

describe("concurrent resolution (two reviewers, double-click, bulk + single)", () => {
  // Both callers read "pending" before opening a transaction; only the first
  // claim matches `status = 'pending'`. The loser's claim matches 0 rows.
  const pendingCreate = {
    id: "p1",
    status: "pending",
    kind: "create",
    proposed,
    submittedById: "u1",
    collectionInstallmentId: "inst1",
  };

  it("an approve that loses the race posts nothing and reports already_resolved", async () => {
    findUnique.mockResolvedValueOnce(pendingCreate);
    txClient.pendingApproval.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await approvePending({ pendingId: "p1", reviewerId: "rev2", reviewerPerms: approver });

    expect(res).toEqual({ error: "already_resolved" });
    expect(txClient.transaction.create).not.toHaveBeenCalled();
    expect(txClient.collectionPlanInstallment.update).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("an update or delete approve that loses the race leaves the ledger row alone", async () => {
    for (const kind of ["update", "delete"] as const) {
      findUnique.mockResolvedValueOnce({ id: "p1", status: "pending", kind, targetTxId: "tx1", proposed });
      txFindUnique.mockResolvedValueOnce(before);
      txClient.pendingApproval.updateMany.mockResolvedValueOnce({ count: 0 });

      const res = await approvePending({ pendingId: "p1", reviewerId: "rev2", reviewerPerms: approver });

      expect(res).toEqual({ error: "already_resolved" });
    }
    expect(txClient.transaction.update).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("a reject that loses to an approve does not revert the installment", async () => {
    findUnique.mockResolvedValueOnce(pendingCreate);
    txClient.pendingApproval.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await rejectPending({ pendingId: "p1", reviewerId: "rev2", reviewerPerms: approver });

    expect(res).toEqual({ error: "already_resolved" });
    expect(txClient.collectionPlanInstallment.update).not.toHaveBeenCalled();
    expect(txClient.collectionPlanInstallment.updateMany).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("other errors inside the transaction still propagate", async () => {
    findUnique.mockResolvedValueOnce(pendingCreate);
    txClient.pendingApproval.updateMany.mockRejectedValueOnce(new Error("db down"));

    await expect(
      approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver }),
    ).rejects.toThrow("db down");
  });
});

describe("collection plan payments", () => {
  it("refuses to post a collection whose UTR reached the candidate's ledger meanwhile", async () => {
    findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "pending",
      kind: "create",
      proposed: { ...proposed, description: "Balance · instalment 2 · UTR HDFC00012345" },
      submittedById: "u1",
      collectionInstallmentId: "inst1",
    });
    txClient.transaction.findMany.mockResolvedValueOnce([
      { id: "old", date: new Date("2026-05-01T00:00:00Z"), amount: { toString: () => "1000" }, description: "Ref hdfc-00012345", collectionInstallment: null, bankMatches: [] },
    ]);

    const res = await approvePending({ pendingId: "p1", reviewerId: "rev1", reviewerPerms: approver });

    expect(res).toEqual({ error: "duplicate_payment_on_approve" });
    expect(txClient.transaction.create).not.toHaveBeenCalled();
    expect(txClient.collectionPlanInstallment.update).not.toHaveBeenCalled();
  });

  it("won't change the amount or date of, or delete, a payment recorded on a plan", async () => {
    txClient.collectionPlanInstallment.findFirst.mockResolvedValue({ planId: "plan1", seq: 2 });
    findUnique.mockResolvedValueOnce({ id: "p2", status: "pending", kind: "update", targetTxId: "tx1", proposed });
    txFindUnique.mockResolvedValueOnce(before);
    expect(await approvePending({ pendingId: "p2", reviewerId: "rev1", reviewerPerms: approver })).toEqual({ error: "plan_linked" });

    findUnique.mockResolvedValueOnce({ id: "p3", status: "pending", kind: "delete", targetTxId: "tx1" });
    txFindUnique.mockResolvedValueOnce(before);
    expect(await approvePending({ pendingId: "p3", reviewerId: "rev1", reviewerPerms: approver })).toEqual({ error: "plan_linked" });
    expect(txClient.transaction.update).not.toHaveBeenCalled();
  });

  it("still lets its description be corrected", async () => {
    txClient.collectionPlanInstallment.findFirst.mockResolvedValue({ planId: "plan1", seq: 2 });
    const same = { ...proposed, date: "2026-04-01T00:00:00.000Z", amount: 500, description: "fixed", partyId: "party1" };
    findUnique.mockResolvedValueOnce({ id: "p4", status: "pending", kind: "update", targetTxId: "tx1", proposed: same });
    txFindUnique.mockResolvedValueOnce(before);
    txClient.transaction.update.mockResolvedValueOnce({ id: "tx1" });

    expect(await approvePending({ pendingId: "p4", reviewerId: "rev1", reviewerPerms: approver })).toMatchObject({ applied: true });
  });
});
