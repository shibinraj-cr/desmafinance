/**
 * enrollLead with the Enroll sheet: the enrollment is dated to the day the
 * money landed, the deal value is the total, and Finance gets an enrollment
 * confirmation to verify, never a revenue draft. A first payment under the
 * minimum asks the sales head. An older client (no sheet) still enrolls, with
 * the payment left for Finance to fill in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findUnique: vi.fn() },
    crmLeadStatus: { findFirst: vi.fn() },
    leadPulseRole: { findUnique: vi.fn() },
    service: { findUnique: vi.fn() },
    subCategory: { findMany: vi.fn() },
    category: { findFirst: vi.fn() },
    transactionDraft: { create: vi.fn() },
    crmEnrollment: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/crm-activity", () => ({ recordLeadActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/ops-activity", () => ({ recordOpsActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/ops-templates", () => ({ getActiveTemplateForService: vi.fn(async () => null) }));
vi.mock("@/lib/ops-projects", () => ({
  createProjectForEnrollment: vi.fn(async () => null),
  resolveDefaultOpsAssignee: vi.fn(async () => null),
}));
vi.mock("@/lib/ops-dates", () => ({ loadHolidaySet: vi.fn(async () => new Set()) }));
vi.mock("@/lib/crm-notify", () => ({
  notifyEnrollment: vi.fn(async () => {}),
  salesHeadUserIds: vi.fn(async () => ["head1"]),
}));

import { prisma } from "@/lib/prisma";
import { applyLeadDeal, enrollLead } from "@/lib/crm-enroll";
import { notifyEnrollment } from "@/lib/crm-notify";
import { recordLeadActivity } from "@/lib/crm-activity";
import type { EnrollConfirm } from "@/lib/crm-enroll-confirm";

const fn = (f: unknown) => f as unknown as ReturnType<typeof vi.fn>;
const NOW = new Date("2026-11-17T06:00:00.000Z"); // 11:30 IST

function makeTx() {
  return {
    lead: { updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn() },
    party: { findUnique: vi.fn(), findFirst: vi.fn(async () => null), update: vi.fn(), create: vi.fn(async () => ({ id: "party1" })) },
    partyService: { upsert: vi.fn(async () => ({ id: "ps1" })) },
    leadPulsePipeline: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(async () => ({ id: "pipe1" })) },
    leadPulseDailyEntry: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: "entry1" })), update: vi.fn() },
    leadPulseDailyClose: { create: vi.fn(async () => ({ id: "close1" })) },
    crmEnrollment: { create: vi.fn(async () => ({ id: "enr1" })) },
  };
}

const sheet = (over: Partial<EnrollConfirm> = {}): EnrollConfirm => ({
  billingName: "Test Candidate",
  billingCountry: "India",
  billingState: "Kerala",
  billingAddress: "1 Test Street",
  billingPin: "682001",
  totalAmount: 121540,
  firstAmount: 34220,
  paidOn: "2026-11-10",
  paymentMode: "Axis Bank",
  utr: "AXIS123456",
  payerRelation: "candidate",
  payerName: null,
  plan: [{ date: "2026-12-10", amount: 87320 }],
  ...over,
});

let tx: ReturnType<typeof makeTx>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  fn(prisma.lead.findUnique).mockResolvedValue({
    id: "lead1",
    candidateName: "Test Candidate",
    email: null,
    phone: null,
    sourceId: "src1",
    serviceId: "svc1",
    assignedToId: "bde1",
    partyId: null,
    pipelineId: null,
    expectedValue: null,
    expectedCloseDate: null,
    referredByLeadId: null,
    country: "India",
    status: { label: "Pipeline", code: "pipeline" },
  });
  fn(prisma.leadPulseRole.findUnique).mockResolvedValue({ role: "l2", active: true });
  fn(prisma.crmLeadStatus.findFirst).mockResolvedValue({ id: "st-enrolled" });
  fn(prisma.service.findUnique).mockResolvedValue({ name: "AHPRA OBA Pathway" });
  fn(prisma.subCategory.findMany).mockResolvedValue([
    { name: "AHPRA OBA Pathway (Collection)", category: { name: "Collection - Nursing Registrations" } },
    { name: "AHPRA OBA Pathway (Sales)", category: { name: "Sales - Nursing Registrations" } },
  ]);
  tx = makeTx();
  fn(prisma.$transaction).mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  return () => vi.useRealTimers();
});

describe("enrollLead with the Enroll sheet", () => {
  it("dates the enrollment to the payment day and hands Finance a confirmation, not a draft", async () => {
    const res = await enrollLead({ leadId: "lead1", actorId: "bde1", confirm: sheet() });

    expect(res).toMatchObject({ enrollmentId: "enr1", draftId: null, partyId: "party1", pipelineId: "pipe1" });
    expect(prisma.transactionDraft.create).not.toHaveBeenCalled();
    // The month it counts in comes from the payment date; the deal value is the total.
    const pipe = fn(tx.leadPulsePipeline.create).mock.calls[0][0].data;
    expect(pipe.closedDate.toISOString().slice(0, 10)).toBe("2026-11-10");
    expect(pipe.expectedFirstInstallment).toBe(121540);
    expect(fn(tx.partyService.upsert).mock.calls[0][0].create.totalAmount).toBe(121540);

    const e = fn(tx.crmEnrollment.create).mock.calls[0][0].data;
    expect(e).toMatchObject({
      status: "pending",
      exception: null,
      billingName: "Test Candidate",
      billingState: "Kerala",
      totalAmount: 121540,
      firstAmount: 34220,
      paymentMode: "Axis Bank",
      utr: "AXIS123456",
      // The first payment is a sale; Finance can re-classify.
      category: "Sales - Nursing Registrations",
      subItem: "AHPRA OBA Pathway (Sales)",
      plan: [{ date: "2026-12-10", amount: 87320 }],
    });
    expect(e.paidOn.toISOString().slice(0, 10)).toBe("2026-11-10");
    expect(e.submitted).toMatchObject({ firstAmount: 34220, utr: "AXIS123456" });
    expect(notifyEnrollment).not.toHaveBeenCalled();
  });

  it("asks the sales head when the first payment is under the minimum", async () => {
    await enrollLead({ leadId: "lead1", actorId: "bde1", confirm: sheet({ firstAmount: 5000, plan: [{ date: "2026-12-10", amount: 116540 }] }) });

    expect(fn(tx.crmEnrollment.create).mock.calls[0][0].data.exception).toBe("pending");
    expect(notifyEnrollment).toHaveBeenCalledWith(expect.objectContaining({ userIds: ["head1"], title: "First payment under the minimum" }));
    expect(fn(recordLeadActivity).mock.calls.map((c) => c[0].type)).toContain("ENROLLMENT_EXCEPTION");
  });

  it("refuses an inconsistent sheet before writing anything", async () => {
    await expect(enrollLead({ leadId: "lead1", actorId: "bde1", confirm: sheet({ utr: null }) })).rejects.toMatchObject({
      status: 400,
      code: "enroll_utr",
    });
    await expect(enrollLead({ leadId: "lead1", actorId: "bde1", confirm: sheet({ paidOn: "2026-11-20" }) })).rejects.toMatchObject({
      code: "enroll_paidOn",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("still enrolls from an older client, leaving the payment for Finance", async () => {
    await enrollLead({ leadId: "lead1", actorId: "bde1", expectedValue: 50000, closedDate: new Date("2026-11-12") });

    expect(prisma.transactionDraft.create).not.toHaveBeenCalled();
    expect(fn(tx.crmEnrollment.create).mock.calls[0][0].data).toMatchObject({
      status: "pending",
      billingName: "Test Candidate",
      billingCountry: "India",
      totalAmount: 50000,
      firstAmount: null,
      paidOn: null,
      paymentMode: null,
      plan: [],
    });
  });
});

describe("Edit deal once enrolled with the sheet", () => {
  it("is refused: the total and date change through the enrollment", async () => {
    fn(prisma.lead.findUnique).mockResolvedValueOnce({
      id: "lead1",
      candidateName: "Test Candidate",
      email: null,
      phone: null,
      sourceId: "src1",
      serviceId: "svc1",
      assignedToId: "bde1",
      partyId: "party1",
      pipelineId: "pipe1",
      status: { code: "enrolled", label: "Enrolled" },
    });
    fn(prisma.crmEnrollment.findFirst).mockResolvedValueOnce({ id: "enr1" });
    await expect(
      applyLeadDeal({ leadId: "lead1", serviceId: "svc2", expectedValue: 1000, expectedCloseDate: new Date("2026-12-01"), actorId: "bde1" }),
    ).rejects.toMatchObject({ status: 400, code: "deal_locked_by_enrollment" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
