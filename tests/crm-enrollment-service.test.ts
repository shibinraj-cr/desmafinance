/**
 * The verification service's guards (src/lib/crm-enrollment.ts): the sales
 * head can't decide their own exception and decides only the amount they saw;
 * Finance can't save over a change made since its screen opened.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    crmEnrollment: { findFirst: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/permissions", () => ({ getCurrentUserAndPermissions: vi.fn() }));
vi.mock("@/lib/crm-activity", () => ({ recordLeadActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/crm-notify", () => ({ notifyEnrollment: vi.fn(async () => {}), salesHeadUserIds: vi.fn(async () => []) }));
vi.mock("@/lib/crm-enroll", () => ({ moveEnrollmentClose: vi.fn(), resolveRevenueClassification: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { decideException, financeSave } from "@/lib/crm-enrollment";

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
