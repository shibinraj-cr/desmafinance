/**
 * F-02 regression: enrollLead() must be idempotent. Before this fix, calling it
 * a second time on an already-enrolled lead (a double-click / two-tab race, or a
 * stale UI that still shows the Enroll button) re-ran the whole enrollment and
 * created a SECOND Finance revenue draft for the same candidate/service. The fix
 * rejects a repeat call with "already_enrolled" before any lookup or write past
 * the initial lead fetch — this test proves both the rejection AND that nothing
 * downstream (status lookup, transaction, revenue draft) ever runs.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findUnique: vi.fn(), update: vi.fn() },
    crmLeadStatus: { findFirst: vi.fn() },
    leadPulseRole: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
    service: { findUnique: vi.fn() },
    subCategory: { findFirst: vi.fn() },
    category: { findFirst: vi.fn() },
    party: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    partyService: { upsert: vi.fn(), count: vi.fn() },
    leadPulsePipeline: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    leadPulseDailyEntry: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    leadPulseDailyClose: { create: vi.fn() },
    transactionDraft: { create: vi.fn() },
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

import { prisma } from "@/lib/prisma";
import { enrollLead } from "@/lib/crm-enroll";

const leadFindUnique = prisma.lead.findUnique as unknown as ReturnType<typeof vi.fn>;
const statusFindFirst = prisma.crmLeadStatus.findFirst as unknown as ReturnType<typeof vi.fn>;
const roleFindUnique = prisma.leadPulseRole.findUnique as unknown as ReturnType<typeof vi.fn>;
const userFindFirst = prisma.user.findFirst as unknown as ReturnType<typeof vi.fn>;
const draftCreate = prisma.transactionDraft.create as unknown as ReturnType<typeof vi.fn>;
const $transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function enrolledLead(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead1",
    candidateName: "Priya Menon",
    email: "priya@example.com",
    phone: "9876543210",
    sourceId: "src1",
    serviceId: "svc1",
    assignedToId: "bde1",
    partyId: "party1",
    pipelineId: "pipe1",
    expectedValue: { toString: () => "50000" },
    expectedCloseDate: new Date("2026-08-01"),
    status: { label: "Enrolled", code: "enrolled" },
    ...overrides,
  };
}

describe("enrollLead — idempotency (F-02)", () => {
  it("rejects re-enrolling an already-enrolled lead, before any further lookup or write", async () => {
    leadFindUnique.mockResolvedValueOnce(enrolledLead());

    await expect(enrollLead({ leadId: "lead1", actorId: "user1" })).rejects.toMatchObject({
      status: 400,
      code: "already_enrolled",
    });

    // Nothing past the guard — the "enrolled" status lookup, the party/pipeline
    // work, the transaction, and (critically) the revenue draft — should ever run.
    expect(statusFindFirst).not.toHaveBeenCalled();
    expect(userFindFirst).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
    expect(draftCreate).not.toHaveBeenCalled();
  });

  it("still 404s on a missing lead — unchanged by this fix", async () => {
    leadFindUnique.mockResolvedValueOnce(null);
    await expect(enrollLead({ leadId: "missing", actorId: "user1" })).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("does not block a lead's first enrollment — the guard only fires when already 'enrolled'", async () => {
    // A non-enrolled lead reaches past the idempotency guard into the real
    // enrollment path, which needs its downstream mocks in place; we only assert
    // it does NOT short-circuit on "already_enrolled" — the fix's precise scope.
    leadFindUnique.mockResolvedValueOnce(
      enrolledLead({ partyId: null, pipelineId: null, status: { label: "Follow Up", code: "follow_up" } }),
    );
    // resolvePipelineOwner(lead) runs BEFORE the "enrolled" status lookup — it
    // needs the lead's assignee to resolve as an active L2 BDE so the flow
    // actually reaches (and calls) statusFindFirst below, rather than bailing
    // out earlier on an unrelated "l2_owner_required" error.
    roleFindUnique.mockResolvedValueOnce({ role: "l2", active: true });
    statusFindFirst.mockResolvedValueOnce({ id: "status-enrolled" }); // the "enrolled" CrmLeadStatus lookup

    let rejection: unknown;
    try {
      await enrollLead({ leadId: "lead1", actorId: "user1" });
    } catch (e) {
      rejection = e;
    }

    // Whatever happens next (it will fail deeper in without a full mock of the
    // party/pipeline/reviewer chain — that's out of scope here), it must NOT be
    // the idempotency guard's error.
    expect((rejection as { code?: string } | undefined)?.code).not.toBe("already_enrolled");
    expect(statusFindFirst).toHaveBeenCalled();
  });
});
