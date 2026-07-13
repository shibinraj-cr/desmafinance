/**
 * Atomicity tests for POST
 * /api/finance/collection-plans/[id]/installments/[installmentId]/submit.
 *
 * Submitting an installment writes TWO linked rows: a ledger Transaction (or a
 * PendingApproval) AND the installment's status/link. If those run as separate
 * top-level writes and the second fails, the first is orphaned — posted revenue
 * with no installment marked received, or a pending row the installment never
 * points at. The fix wraps each pair in one prisma.$transaction; these tests
 * prove both writes land on the interactive tx client, and that a mid-write
 * failure aborts the unit (no post-commit audit).
 *
 * The mock $transaction handles both call shapes the route uses: the array form
 * (persisting the user's category/mode picks) resolves as-is, and the callback
 * form (the atomic write) runs against a mock tx client we can assert on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Permissions } from "@/lib/rbac";

vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    collectionPlanInstallment: { findUnique: vi.fn(), update: vi.fn() },
    collectionPlan: { update: vi.fn() },
    transaction: { create: vi.fn() },
    pendingApproval: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/master-data", () => ({
  verifyCategorySubItem: vi.fn(async () => null),
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { POST as submitPost } from "@/app/api/finance/collection-plans/[id]/installments/[installmentId]/submit/route";

const getPerms = getCurrentUserAndPermissions as unknown as ReturnType<typeof vi.fn>;
const instFindUnique = prisma.collectionPlanInstallment.findUnique as unknown as ReturnType<typeof vi.fn>;
const $transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const prismaTxCreate = prisma.transaction.create as unknown as ReturnType<typeof vi.fn>;
const prismaPendingCreate = prisma.pendingApproval.create as unknown as ReturnType<typeof vi.fn>;
const auditMock = recordAudit as unknown as ReturnType<typeof vi.fn>;

// The interactive-transaction client the callback form of $transaction receives.
let txClient: {
  transaction: { create: ReturnType<typeof vi.fn> };
  pendingApproval: { create: ReturnType<typeof vi.fn> };
  collectionPlanInstallment: { update: ReturnType<typeof vi.fn> };
};

function perms(overrides: Partial<Permissions> = {}): Permissions {
  return {
    isAdmin: false,
    canApprove: false,
    needsApproval: true,
    draftFirst: false,
    pages: ["/finance/collection-plan"],
    roleName: "Test",
    ...overrides,
  };
}

/** A pending installment on an active plan whose party is active, with every
 *  submit field already resolvable from plan/installment (so no body needed). */
function pendingInstallment() {
  return {
    id: "inst1",
    planId: "plan1",
    status: "pending",
    amount: { toString: () => "5000" },
    expectedDate: new Date("2026-07-20T00:00:00.000Z"),
    category: "Collection - Nursing Registrations",
    subItem: "AHPRA OBA Pathway (Collection)",
    paymentMode: "HDFC Bank",
    description: "inst desc",
    plan: {
      id: "plan1",
      status: "active",
      partyId: "party1",
      label: "Plan A",
      category: "Collection - Nursing Registrations",
      subItem: "AHPRA OBA Pathway (Collection)",
      paymentMode: "HDFC Bank",
      expDom: "DOM",
      party: { id: "party1", isActive: true },
    },
  };
}

function req() {
  return new Request("http://t/api/finance/collection-plans/plan1/installments/inst1/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

const params = { params: { id: "plan1", installmentId: "inst1" } };

beforeEach(() => {
  vi.clearAllMocks();
  txClient = {
    transaction: { create: vi.fn() },
    pendingApproval: { create: vi.fn() },
    collectionPlanInstallment: { update: vi.fn() },
  };
  // Array form (persist picks) resolves as-is; callback form (atomic write)
  // runs against the mock tx client and returns whatever it resolves to.
  $transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof txClient) => unknown)(txClient);
    return arg;
  });
  instFindUnique.mockResolvedValue(pendingInstallment());
});

describe("canApprove path — direct ledger write", () => {
  it("creates the Transaction and links the installment inside ONE transaction", async () => {
    getPerms.mockResolvedValue({
      perms: perms({ canApprove: true, needsApproval: false }),
      userId: "u1",
    });
    txClient.transaction.create.mockResolvedValue({ id: "tx1" });
    txClient.collectionPlanInstallment.update.mockResolvedValue({
      id: "inst1",
      status: "received",
      amount: { toString: () => "5000" },
    });

    const res = await submitPost(req() as never, params);

    expect(res.status).toBe(200);
    // Both writes ran on the interactive tx client...
    expect(txClient.transaction.create).toHaveBeenCalledTimes(1);
    expect(txClient.collectionPlanInstallment.update).toHaveBeenCalledWith({
      where: { id: "inst1" },
      data: { status: "received", transactionId: "tx1", pendingApprovalId: null },
    });
    // ...NOT as a loose top-level prisma.transaction.create (which would orphan
    // on a failed link).
    expect(prismaTxCreate).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("aborts without auditing when the installment link fails mid-transaction", async () => {
    getPerms.mockResolvedValue({
      perms: perms({ canApprove: true, needsApproval: false }),
      userId: "u1",
    });
    txClient.transaction.create.mockResolvedValue({ id: "tx1" });
    txClient.collectionPlanInstallment.update.mockRejectedValue(new Error("db down"));

    await expect(submitPost(req() as never, params)).rejects.toThrow("db down");
    // The shared transaction rolls back the create; the post-commit audit never fires.
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe("executive path — enqueue for approval", () => {
  it("creates the PendingApproval and links the installment inside ONE transaction", async () => {
    getPerms.mockResolvedValue({ perms: perms(), userId: "u1" });
    txClient.pendingApproval.create.mockResolvedValue({ id: "pend1" });
    txClient.collectionPlanInstallment.update.mockResolvedValue({
      id: "inst1",
      status: "submitted",
      amount: { toString: () => "5000" },
    });

    const res = await submitPost(req() as never, params);

    expect(res.status).toBe(200);
    expect(txClient.pendingApproval.create).toHaveBeenCalledTimes(1);
    expect(txClient.collectionPlanInstallment.update).toHaveBeenCalledWith({
      where: { id: "inst1" },
      data: { status: "submitted", pendingApprovalId: "pend1" },
    });
    expect(prismaPendingCreate).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("aborts without auditing when the installment link fails mid-transaction", async () => {
    getPerms.mockResolvedValue({ perms: perms(), userId: "u1" });
    txClient.pendingApproval.create.mockResolvedValue({ id: "pend1" });
    txClient.collectionPlanInstallment.update.mockRejectedValue(new Error("db down"));

    await expect(submitPost(req() as never, params)).rejects.toThrow("db down");
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe("authorization", () => {
  it("returns 403 for a caller without the Collection Plan page and never reads the installment", async () => {
    getPerms.mockResolvedValue({ perms: perms({ pages: ["/finance/overview"] }), userId: "u1" });
    const res = await submitPost(req() as never, params);
    expect(res.status).toBe(403);
    expect(instFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    getPerms.mockResolvedValue({ perms: null, userId: null });
    const res = await submitPost(req() as never, params);
    expect(res.status).toBe(401);
    expect(instFindUnique).not.toHaveBeenCalled();
  });
});
