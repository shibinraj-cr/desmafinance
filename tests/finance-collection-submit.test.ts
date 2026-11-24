/**
 * Tests for POST
 * /api/finance/collection-plans/[id]/installments/[installmentId]/submit
 * (Record payment on a collection plan).
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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { Permissions } from "@/lib/rbac";

vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    collectionPlanInstallment: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    collectionPlan: { update: vi.fn() },
    transaction: { create: vi.fn(), findMany: vi.fn() },
    pendingApproval: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/master-data", () => ({
  verifyCategorySubItem: vi.fn(async () => null),
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

// Invoice settings: HDFC invoices from 1 Jul 2026.
vi.mock("@/lib/invoices/server", () => ({
  loadSettings: vi.fn(async () => ({ banks: [{ paymentMode: "HDFC Bank", isActive: true }], startsOn: "2026-07-01" })),
}));

// The plan change itself is tested in tests/collection-payment.test.ts; here,
// only that it runs on the same transaction as the ledger write.
vi.mock("@/lib/collection-payment-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/collection-payment-server")>()),
  applyPaymentToPlan: vi.fn(async () => ({ received: { id: "inst1", seq: 2, amount: 5000 }, rest: null, reduced: [], covered: [] })),
}));

import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { applyPaymentToPlan } from "@/lib/collection-payment-server";
import { POST as submitPost } from "@/app/api/finance/collection-plans/[id]/installments/[installmentId]/submit/route";

const getPerms = getCurrentUserAndPermissions as unknown as ReturnType<typeof vi.fn>;
const instFindUnique = prisma.collectionPlanInstallment.findUnique as unknown as ReturnType<typeof vi.fn>;
const $transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const prismaTxCreate = prisma.transaction.create as unknown as ReturnType<typeof vi.fn>;
const prismaPendingCreate = prisma.pendingApproval.create as unknown as ReturnType<typeof vi.fn>;
const auditMock = recordAudit as unknown as ReturnType<typeof vi.fn>;
const applyMock = applyPaymentToPlan as unknown as ReturnType<typeof vi.fn>;
const instFindMany = prisma.collectionPlanInstallment.findMany as unknown as ReturnType<typeof vi.fn>;

// The interactive-transaction client the callback form of $transaction receives.
let txClient: {
  transaction: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  pendingApproval: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  collectionPlanInstallment: { update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
};
const ledgerFindMany = prisma.transaction.findMany as unknown as ReturnType<typeof vi.fn>;
const waitingFindMany = prisma.pendingApproval.findMany as unknown as ReturnType<typeof vi.fn>;

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
    seq: 2,
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
      party: { id: "party1", isActive: true, group: "Candidate" },
    },
  };
}

const PAID = { paidOn: "2026-07-22", amount: 5000, utr: "HDFC0000123456" };

function req(body: Record<string, unknown> = PAID) {
  return new Request("http://t/api/finance/collection-plans/plan1/installments/inst1/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: { id: "plan1", installmentId: "inst1" } };

beforeEach(() => {
  vi.clearAllMocks();
  txClient = {
    // findMany: the candidate's ledger, searched again for the UTR inside the write.
    transaction: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    // findMany/deleteMany: a rejected entry for the instalment, replaced by this one.
    pendingApproval: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    // updateMany: the instalment is claimed only while it is still due.
    collectionPlanInstallment: { update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  ledgerFindMany.mockResolvedValue([]);
  waitingFindMany.mockResolvedValue([]);
  // Array form (persist picks) resolves as-is; callback form (atomic write)
  // runs against the mock tx client and returns whatever it resolves to.
  $transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof txClient) => unknown)(txClient);
    return arg;
  });
  instFindUnique.mockResolvedValue(pendingInstallment());
  instFindMany.mockResolvedValue([
    { id: "inst1", seq: 2, expectedDate: new Date("2026-07-20T00:00:00.000Z"), amount: { toString: () => "5000" }, status: "pending" },
    { id: "inst2", seq: 3, expectedDate: new Date("2026-08-20T00:00:00.000Z"), amount: { toString: () => "5000" }, status: "pending" },
  ]);
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
    expect(applyMock).toHaveBeenCalledWith(txClient, { instalmentId: "inst1", transactionId: "tx1", paid: 5000 });
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
    applyMock.mockRejectedValueOnce(new Error("db down"));

    await expect(submitPost(req() as never, params)).rejects.toThrow("db down");
    // The shared transaction rolls back the create; the post-commit audit never fires.
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe("executive path — enqueue for approval", () => {
  it("creates the PendingApproval and links the installment inside ONE transaction", async () => {
    getPerms.mockResolvedValue({ perms: perms(), userId: "u1" });
    txClient.pendingApproval.create.mockResolvedValue({ id: "pend1" });

    const res = await submitPost(req() as never, params);

    expect(res.status).toBe(200);
    expect(txClient.pendingApproval.create).toHaveBeenCalledTimes(1);
    expect(txClient.collectionPlanInstallment.updateMany).toHaveBeenCalledWith({
      where: { id: "inst1", status: "pending" },
      data: { status: "submitted", pendingApprovalId: "pend1" },
    });
    expect(prismaPendingCreate).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("aborts without auditing when the installment link fails mid-transaction", async () => {
    getPerms.mockResolvedValue({ perms: perms(), userId: "u1" });
    txClient.pendingApproval.create.mockResolvedValue({ id: "pend1" });
    txClient.collectionPlanInstallment.updateMany.mockRejectedValue(new Error("db down"));

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

const approver = () => getPerms.mockResolvedValue({ perms: perms({ canApprove: true, needsApproval: false }), userId: "u1" });
const posted = () => {
  txClient.transaction.create.mockResolvedValue({ id: "tx1" });
};

describe("the payment as it arrived", () => {
  it("posts the date the money landed and the amount received, not the plan's", async () => {
    approver();
    posted();
    const res = await submitPost(req({ ...PAID, amount: 3500, paidOn: "2026-07-22" }) as never, params);
    expect(res.status).toBe(200);
    expect(txClient.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          date: new Date("2026-07-22T00:00:00.000Z"),
          month: "Jul-26",
          amount: 3500,
          paymentMode: "HDFC Bank",
          // The UTR goes in the description, where bank reconciliation matches it.
          description: "Plan A · instalment 2 · inst desc · UTR HDFC0000123456",
        }),
      }),
    );
    expect(applyMock).toHaveBeenCalledWith(txClient, { instalmentId: "inst1", transactionId: "tx1", paid: 3500 });
  });

  it("names who paid when it wasn't the candidate", async () => {
    approver();
    posted();
    await submitPost(req({ ...PAID, paidBy: "Test Parent" }) as never, params);
    expect(txClient.transaction.create.mock.calls[0][0].data.description).toBe(
      "Plan A · instalment 2 · inst desc · UTR HDFC0000123456 · paid by Test Parent",
    );
  });

  it("tells an approver the payment can be invoiced now", async () => {
    approver();
    posted();
    const body = await (await submitPost(req() as never, params)).json();
    expect(body).toMatchObject({ applied: true, transactionId: "tx1", invoice: { canIssue: true, reason: null } });
  });

  it("says why a cash payment gets no invoice", async () => {
    approver();
    posted();
    const body = await (await submitPost(req({ ...PAID, paymentMode: "Cash", utr: null }) as never, params)).json();
    expect(body.invoice.canIssue).toBe(false);
    expect(body.invoice.reason).toMatch(/Axis, HDFC or Wio/);
  });

  it("sends an executive's payment for approval with the paid date and amount", async () => {
    getPerms.mockResolvedValue({ perms: perms(), userId: "u1" });
    txClient.pendingApproval.create.mockResolvedValue({ id: "pend1" });
    const res = await submitPost(req({ ...PAID, amount: 7000 }) as never, params);
    expect(res.status).toBe(200);
    const proposed = txClient.pendingApproval.create.mock.calls[0][0].data.proposed;
    expect(proposed).toMatchObject({ date: "2026-07-22T00:00:00.000Z", amount: 7000, month: "Jul-26" });
    // The plan changes when it's approved, not now.
    expect(applyMock).not.toHaveBeenCalled();
  });
});

describe("refused before anything is written", () => {
  it("a bank payment without its UTR", async () => {
    approver();
    const res = await submitPost(req({ ...PAID, utr: " 12 " }) as never, params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "utr_required" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("a date in the future", async () => {
    approver();
    const res = await submitPost(req({ ...PAID, paidOn: "2099-01-01" }) as never, params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "paid_in_future" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("more than the plan still has due, saying how much it can take", async () => {
    approver();
    const res = await submitPost(req({ ...PAID, amount: 10001 }) as never, params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "collection_more_than_due", maxAmount: 10000 });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("an executive's too, before it reaches Approvals", async () => {
    getPerms.mockResolvedValue({ perms: perms(), userId: "u1" });
    const res = await submitPost(req({ ...PAID, amount: 10001 }) as never, params);
    expect(res.status).toBe(409);
    expect(txClient.pendingApproval.create).not.toHaveBeenCalled();
  });

  it("a payment with no date or amount", async () => {
    approver();
    const res = await submitPost(req({ utr: "HDFC0000123456" }) as never, params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed" });
  });
});

describe("ledger month — no silent clamp", () => {
  afterEach(() => vi.useRealTimers());

  it("refuses a payment dated after the tracked months (until the year rolls over)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-04-20T06:00:00.000Z"));
    approver();
    const res = await submitPost(req({ ...PAID, paidOn: "2027-04-15" }) as never, params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "month_out_of_range" });
    expect($transaction).not.toHaveBeenCalled();
  });
});

const booked = (description: string) => ({
  id: "old1",
  date: new Date("2026-07-21T00:00:00.000Z"),
  amount: { toString: () => "5000" },
  description,
  collectionInstallment: null,
  bankMatches: [],
});

describe("the same money twice", () => {
  it("refuses a UTR already on the candidate's ledger, and offers an approver the link", async () => {
    approver();
    ledgerFindMany.mockResolvedValue([booked("NEFT from candidate · Ref HDFC0000123456")]);
    const res = await submitPost(req() as never, params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "duplicate_payment",
      existing: { source: "ledger", id: "old1", date: "2026-07-21", amount: 5000, description: "NEFT from candidate · Ref HDFC0000123456" },
      canLink: true,
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("matches the UTR on a bank line matched to the entry", async () => {
    approver();
    ledgerFindMany.mockResolvedValue([
      { ...booked("Second instalment"), bankMatches: [{ bankTransaction: { referenceNumber: null, upiReference: null, bankReference: "hdfc 0000123456", description: "NEFT" } }] },
    ]);
    expect((await submitPost(req() as never, params)).status).toBe(409);
  });

  it("an executive is told, but can't link", async () => {
    getPerms.mockResolvedValue({ perms: perms(), userId: "u1" });
    ledgerFindMany.mockResolvedValue([booked("x · UTR HDFC0000123456")]);
    const body = await (await submitPost(req() as never, params)).json();
    expect(body).toMatchObject({ error: "duplicate_payment", canLink: false });
    expect(txClient.pendingApproval.create).not.toHaveBeenCalled();
  });

  it("also an entry with that UTR still waiting for approval", async () => {
    approver();
    waitingFindMany.mockResolvedValue([
      { id: "pa9", proposed: { type: "Revenue", date: "2026-07-21T00:00:00.000Z", amount: 5000, description: "Daily tracker · UTR HDFC0000123456" } },
    ]);
    const body = await (await submitPost(req() as never, params)).json();
    expect(body).toMatchObject({ error: "duplicate_payment", existing: { source: "approval", id: "pa9" }, canLink: false });
  });

  it("a different UTR, or none (cash), goes through", async () => {
    approver();
    posted();
    ledgerFindMany.mockResolvedValue([booked("x · UTR HDFC0000999999")]);
    expect((await submitPost(req() as never, params)).status).toBe(200);
    expect((await submitPost(req({ ...PAID, paymentMode: "Cash", utr: null }) as never, params)).status).toBe(200);
  });
});

describe("after a rejection", () => {
  it("replaces the rejected entry for the instalment instead of failing on it", async () => {
    getPerms.mockResolvedValue({ perms: perms(), userId: "u1" });
    txClient.pendingApproval.findMany.mockResolvedValue([{ id: "rej1" }]);
    txClient.pendingApproval.create.mockResolvedValue({ id: "pend2" });
    const res = await submitPost(req() as never, params);
    expect(res.status).toBe(200);
    expect(txClient.pendingApproval.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["rej1"] } } });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ entityId: "rej1", action: "DELETE" }));
  });

  it("says so, instead of a 500, when another entry holds the instalment", async () => {
    getPerms.mockResolvedValue({ perms: perms(), userId: "u1" });
    txClient.pendingApproval.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6" }));
    const res = await submitPost(req() as never, params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "pending_exists" });
  });

  it("refuses when the instalment stopped being due meanwhile", async () => {
    getPerms.mockResolvedValue({ perms: perms(), userId: "u1" });
    txClient.pendingApproval.create.mockResolvedValue({ id: "pend2" });
    txClient.collectionPlanInstallment.updateMany.mockResolvedValue({ count: 0 });
    const res = await submitPost(req() as never, params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "installment_not_pending" });
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe("dates before DesGro's books", () => {
  it("applies the ledger's rules for historical entries", async () => {
    approver();
    expect(await (await submitPost(req({ ...PAID, paidOn: "2020-05-01" }) as never, params)).json()).toEqual({ error: "historical_too_old" });
    instFindUnique.mockResolvedValue({ ...pendingInstallment(), category: "Other Income", plan: { ...pendingInstallment().plan, category: "Other Income" } });
    expect(await (await submitPost(req({ ...PAID, paidOn: "2025-05-01" }) as never, params)).json()).toEqual({ error: "historical_payments_only" });
    expect($transaction).not.toHaveBeenCalled();
  });
});
