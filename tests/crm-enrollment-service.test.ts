/**
 * The verification service's guards (src/lib/crm-enrollment.ts): the sales
 * head can't decide their own exception and decides only the amount they saw;
 * Finance can't save over a change made since its screen opened; the Finance
 * Executive submits only what the manager could approve, and the manager
 * returns only what's waiting.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    crmEnrollment: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/permissions", () => ({ getCurrentUserAndPermissions: vi.fn() }));
vi.mock("@/lib/crm-activity", () => ({ recordLeadActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/crm-notify", () => ({ notifyEnrollment: vi.fn(async () => {}), salesHeadUserIds: vi.fn(async () => []) }));
vi.mock("@/lib/crm-enroll", () => ({ moveEnrollmentClose: vi.fn(), resolveRevenueClassification: vi.fn() }));
vi.mock("@/lib/master-data", () => ({ verifyCategorySubItem: vi.fn(async () => null) }));

import { prisma } from "@/lib/prisma";
import { recordLeadActivity } from "@/lib/crm-activity";
import { decideException, financeSave, returnToChecker, sendBack, submitForApproval } from "@/lib/crm-enrollment";

const fn = (f: unknown) => f as unknown as ReturnType<typeof vi.fn>;
const UPDATED = new Date("2026-11-17T08:00:00.000Z");
const row = {
  id: "enr1",
  leadId: "lead1",
  partyId: "party1",
  serviceId: "svc1",
  pipelineId: "pipe1",
  ownerUserId: "bde1",
  submittedById: "bde1",
  status: "pending",
  exception: "pending",
  exceptionAt: null,
  exceptionNote: null,
  billingName: "Test Candidate",
  billingCountry: "India",
  billingState: "Kerala",
  billingAddress: null,
  billingPin: null,
  totalAmount: { toString: () => "121540" },
  firstAmount: { toString: () => "8000" },
  paidOn: new Date("2026-11-10T00:00:00Z"),
  paymentMode: "Axis Bank",
  utr: "AXIS1",
  payerRelation: "candidate",
  payerName: null,
  plan: [{ date: "2026-12-10", amount: 113540 }],
  category: "Sales - Nursing Registrations",
  subItem: "AHPRA OBA Pathway (Sales)",
  expDom: null,
  submitted: {},
  financeNote: null,
  transactionId: null,
  collectionPlanId: null,
  verifiedAt: null,
  createdAt: UPDATED,
  updatedAt: UPDATED,
  lead: { candidateName: "Test Candidate", country: "India" },
  service: { name: "AHPRA OBA Pathway" },
  owner: null,
  submittedBy: null,
  verifiedBy: null,
  exceptionBy: null,
  transaction: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  fn(prisma.crmEnrollment.findFirst).mockResolvedValue(row);
  fn(prisma.crmEnrollment.updateMany).mockResolvedValue({ count: 1 });
});

describe("decideException", () => {
  const base = { leadId: "lead1", approve: true, note: null, expectedFirstAmount: 8000 };

  it("refuses the BDE's own enrollment unless they're an admin", async () => {
    await expect(decideException({ ...base, actorId: "bde1", actorIsAdmin: false })).rejects.toMatchObject({ status: 403 });
    expect(prisma.crmEnrollment.updateMany).not.toHaveBeenCalled();
    await expect(decideException({ ...base, actorId: "bde1", actorIsAdmin: true })).resolves.toEqual({ decision: "approved" });
  });

  it("decides only the amount the sales head saw", async () => {
    await decideException({ ...base, actorId: "head1", actorIsAdmin: false });
    expect(fn(prisma.crmEnrollment.updateMany).mock.calls[0][0].where).toEqual({ id: "enr1", exception: "pending", firstAmount: 8000 });
    fn(prisma.crmEnrollment.updateMany).mockResolvedValueOnce({ count: 0 });
    await expect(decideException({ ...base, actorId: "head1", actorIsAdmin: false, expectedFirstAmount: 9000 })).rejects.toMatchObject({
      status: 409,
      code: "no_exception",
    });
  });
});

describe("financeSave", () => {
  it("refuses a screen opened before the latest change", async () => {
    const tx = {
      $queryRaw: vi.fn(async () => []),
      crmEnrollment: { findUnique: vi.fn(async () => row), updateMany: vi.fn() },
    };
    fn(prisma.$transaction).mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
    const a = { userId: "fm1", perms: {} as never, canView: true, canApprove: true };
    await expect(financeSave(a, "enr1", { utr: "AXIS2" }, "2026-11-17T07:59:00.000Z")).rejects.toMatchObject({
      status: 409,
      code: "enrollment_stale",
    });
    expect(tx.crmEnrollment.updateMany).not.toHaveBeenCalled();
  });
});

const executive = { userId: "fe1", perms: {} as never, canView: true, canApprove: false };
const manager = { userId: "fm1", perms: {} as never, canView: true, canApprove: true };
/** Ready to approve: first payment over the minimum, classified, EXP/DOM picked. */
const ready = { ...row, exception: null, firstAmount: { toString: () => "25000" }, plan: [{ date: "2026-12-10", amount: 96540 }], expDom: "DOM" };

function txWith(e: unknown) {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    crmEnrollment: { findUnique: vi.fn(async () => e), updateMany: vi.fn(async (_args: { where: unknown; data: Record<string, unknown> }) => ({ count: 1 })) },
  };
  fn(prisma.$transaction).mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  return tx;
}

describe("submitForApproval", () => {
  it("marks it checked by the executive, still pending, and says so on the lead", async () => {
    const tx = txWith({ ...ready, returnNote: "Check the date" });
    await submitForApproval(executive, "enr1", null, UPDATED.toISOString());
    const call = tx.crmEnrollment.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ id: "enr1", status: { in: ["pending"] } });
    expect(call.data).toMatchObject({ checkedById: "fe1", returnNote: null });
    expect(call.data).not.toHaveProperty("status");
    expect(call.data.checkedAt).toBeInstanceOf(Date);
    expect(recordLeadActivity).toHaveBeenCalledWith(expect.objectContaining({ type: "ENROLLMENT_CHECKED" }));
  });

  it("only from To verify: not one sent back to the BDE or marked money not received", async () => {
    for (const status of ["sent_back", "not_received"]) {
      const tx = txWith({ ...ready, status });
      await expect(submitForApproval(executive, "enr1", null)).rejects.toMatchObject({ status: 409, code: "enrollment_closed" });
      expect(tx.crmEnrollment.updateMany).not.toHaveBeenCalled();
    }
  });

  it("refuses one the manager couldn't approve yet, writing nothing", async () => {
    const tx = txWith(row); // first payment under the minimum, sales head not asked yet
    await expect(submitForApproval(executive, "enr1", null)).rejects.toMatchObject({ status: 409, code: "cannot_submit" });
    expect(tx.crmEnrollment.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a screen opened before the latest change", async () => {
    const tx = txWith(ready);
    await expect(submitForApproval(executive, "enr1", null, "2026-11-17T07:59:00.000Z")).rejects.toMatchObject({ code: "enrollment_stale" });
    expect(tx.crmEnrollment.updateMany).not.toHaveBeenCalled();
  });
});

describe("returnToChecker", () => {
  it("is the approver's, and needs a reason", async () => {
    await expect(returnToChecker(executive, "enr1", "Recheck the UTR")).rejects.toMatchObject({ status: 403 });
    await expect(returnToChecker(manager, "enr1", "  ")).rejects.toMatchObject({ code: "note_required" });
    expect(prisma.crmEnrollment.updateMany).not.toHaveBeenCalled();
  });

  it("takes back only the version the manager opened, still waiting for approval, with the reason", async () => {
    await returnToChecker(manager, "enr1", "Recheck the UTR", UPDATED.toISOString());
    expect(prisma.crmEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: "enr1", status: "pending", checkedAt: { not: null }, updatedAt: UPDATED },
      data: { checkedAt: null, checkedById: null, returnNote: "Recheck the UTR" },
    });
    fn(prisma.crmEnrollment.updateMany).mockResolvedValueOnce({ count: 0 });
    await expect(returnToChecker(manager, "enr1", "Recheck the UTR")).rejects.toMatchObject({ status: 409 });
  });
});

describe("sendBack", () => {
  it("takes it out of the approval queue, keeping any return note", async () => {
    fn(prisma.crmEnrollment.findUnique).mockResolvedValue({ ...ready, checkedAt: UPDATED, checkedById: "fe1" });
    await sendBack(manager, "enr1", "The UTR is for another candidate");
    expect(prisma.crmEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: "enr1", status: { in: ["pending", "not_received"] } },
      data: { status: "sent_back", financeNote: "The UTR is for another candidate", checkedAt: null, checkedById: null },
    });
  });
});
