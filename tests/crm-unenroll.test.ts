/**
 * Un-enroll — the dedicated undo for an accidental enrollment.
 *
 * Enrolling writes across Marketing (a closed-won tick in a BDE's month),
 * Finance (a revenue draft) and Operations (a project with its full step list),
 * so the undo has to unwind each one in the right order and refuse outright once
 * the money has moved past the draft stage. These tests pin the behaviour that
 * actually protects data: the refusal, the daily-close reversal arithmetic, and
 * the delete-vs-cancel decision for the operations project.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findUnique: vi.fn(), update: vi.fn() },
    leadActivity: { findFirst: vi.fn() },
    leadPulsePipeline: { findUnique: vi.fn(), update: vi.fn() },
    leadPulseDailyClose: { findUnique: vi.fn(), delete: vi.fn() },
    leadPulseDailyEntry: { update: vi.fn() },
    transactionDraft: { findUnique: vi.fn(), delete: vi.fn() },
    auditLog: { findFirst: vi.fn() },
    partyService: { findUnique: vi.fn(), delete: vi.fn() },
    opsProject: { findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() },
    opsTask: { count: vi.fn() },
    opsDocument: { count: vi.fn() },
    opsActionItem: { count: vi.fn() },
    crmLeadStatus: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/crm-activity", () => ({ recordLeadActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/ops-activity", () => ({ recordOpsActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/crm-enroll", () => ({ syncPipelineToLeadStatus: vi.fn(async () => {}) }));

import { prisma } from "@/lib/prisma";
import { previewUnenroll, unenrollLead } from "@/lib/crm-unenroll";

const fn = (f: unknown) => f as unknown as ReturnType<typeof vi.fn>;

const ENROLLED_AT = new Date("2026-09-10T06:30:00.000Z");
const FOLLOW_UP = { id: "st-follow", code: "follow_up", label: "Follow-Up", active: true };

/** The transaction client the mocked $transaction hands the callback. */
type TxSpies = ReturnType<typeof makeTx>;
function makeTx() {
  return {
    lead: { findUnique: vi.fn(), update: vi.fn() },
    leadPulseDailyClose: { findUnique: vi.fn(), delete: vi.fn() },
    leadPulseDailyEntry: { update: vi.fn() },
    leadPulsePipeline: { update: vi.fn() },
    transactionDraft: { findUnique: vi.fn(), delete: vi.fn() },
    opsProject: { delete: vi.fn(), update: vi.fn() },
    partyService: { delete: vi.fn() },
  };
}

type Scenario = {
  statusCode?: string;
  /** null → the lead has no pipeline row at all. */
  pipeline?: { id: string; status: string; dailyCloseId: string | null } | null;
  /** The REVENUE_DRAFTED activity's recorded draft id (null → none recorded). */
  recordedDraftId?: string | null;
  /** null → the draft row is gone. */
  draftRow?: { id: string; amount: { toString: () => string }; submittedBy: { username: string } | null } | null;
  /** Whether a DRAFT_DISCARD audit exists for the recorded draft id. */
  draftDiscarded?: boolean;
  partyService?: { id: string; createdAt: Date } | null;
  opsProject?: { id: string; status: string; leadId: string | null } | null;
  opsCounts?: { taskCount: number; touched: number; docs: number; items: number };
  /** The daily close row the pipeline points at (null → already gone). */
  close?: { id: string; entry: { id: string; closedWon: number } } | null;
};

function setup(s: Scenario = {}): TxSpies {
  const {
    statusCode = "enrolled",
    pipeline = { id: "pipe1", status: "closed_won", dailyCloseId: "close1" },
    recordedDraftId = "draft1",
    draftRow = { id: "draft1", amount: { toString: () => "50000" }, submittedBy: { username: "ganga" } },
    draftDiscarded = false,
    partyService = { id: "ps1", createdAt: ENROLLED_AT },
    opsProject = { id: "proj1", status: "active", leadId: "lead1" },
    opsCounts = { taskCount: 12, touched: 0, docs: 0, items: 0 },
    close = { id: "close1", entry: { id: "entry1", closedWon: 3 } },
  } = s;

  fn(prisma.lead.findUnique).mockResolvedValue({
    id: "lead1",
    candidateName: "Priya Menon",
    partyId: "party1",
    pipelineId: pipeline?.id ?? null,
    serviceId: "svc1",
    expectedValue: { toString: () => "50000" },
    status: { code: statusCode, label: statusCode === "enrolled" ? "Enrolled" : "Follow-Up" },
    service: { name: "AHPRA OBA" },
  });

  fn(prisma.leadActivity.findFirst).mockImplementation(async (args: { where: { type: string } }) => {
    if (args.where.type === "ENROLLED") return { occurredAt: ENROLLED_AT };
    if (args.where.type === "REVENUE_DRAFTED") return { metadata: { draftId: recordedDraftId } };
    return null;
  });

  fn(prisma.leadPulsePipeline.findUnique).mockResolvedValue(pipeline);
  fn(prisma.transactionDraft.findUnique).mockResolvedValue(draftRow);
  fn(prisma.auditLog.findFirst).mockResolvedValue(draftDiscarded ? { id: "audit1" } : null);
  fn(prisma.partyService.findUnique).mockResolvedValue(partyService);
  fn(prisma.opsProject.findUnique).mockResolvedValue(opsProject);
  // Both task counts hit the same mock and are issued together via Promise.all,
  // so branch on the query rather than queueing responses in order — the
  // "touched" count is the one carrying the OR filter.
  fn(prisma.opsTask.count).mockImplementation(async (args: { where?: { OR?: unknown } }) =>
    args?.where?.OR ? opsCounts.touched : opsCounts.taskCount,
  );
  fn(prisma.opsDocument.count).mockResolvedValue(opsCounts.docs);
  fn(prisma.opsActionItem.count).mockResolvedValue(opsCounts.items);
  fn(prisma.crmLeadStatus.findUnique).mockResolvedValue(FOLLOW_UP);

  const tx = makeTx();
  tx.lead.findUnique.mockResolvedValue({ id: "lead1", status: { code: statusCode, label: "Enrolled" } });
  tx.leadPulseDailyClose.findUnique.mockResolvedValue(close);
  tx.transactionDraft.findUnique.mockResolvedValue(draftRow ? { id: draftRow.id } : null);
  fn(prisma.$transaction).mockImplementation(async (cb: (t: TxSpies) => Promise<unknown>) => cb(tx));
  return tx;
}

const run = (over: Partial<Parameters<typeof unenrollLead>[0]> = {}) =>
  unenrollLead({ leadId: "lead1", toStatusId: "st-follow", actorId: "user1", ...over });

beforeEach(() => vi.clearAllMocks());

describe("previewUnenroll — what the confirm dialog is told", () => {
  it("lists the pipeline, daily-close, revenue-draft and ops effects of a clean enrollment", async () => {
    setup();
    const plan = await previewUnenroll("lead1");

    expect(plan.blockers).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.effects.join(" ")).toContain("back to In forecast");
    expect(plan.effects.join(" ")).toContain("Actual drops by one");
    expect(plan.effects.join(" ")).toContain("₹50,000 Revenue draft");
    expect(plan.effects.join(" ")).toContain("12 untouched steps");
    // The Party master row is never removed by an un-enroll — the dialog says so
    // rather than leaving the user to discover it.
    expect(plan.retained.join(" ")).toContain("Party record");
  });

  it("warns (but does not block) when Operations has already worked the project", async () => {
    setup({ opsCounts: { taskCount: 12, touched: 4, docs: 2, items: 1 } });
    const plan = await previewUnenroll("lead1");

    expect(plan.blockers).toEqual([]);
    expect(plan.warnings.map((w) => w.code)).toEqual(["ops_in_progress"]);
    expect(plan.effects.join(" ")).toContain("cancelled");
  });

  it("keeps a pre-existing package amount and says the old figure is unrecoverable", async () => {
    setup({ partyService: { id: "ps1", createdAt: new Date("2026-01-01T00:00:00.000Z") } });
    const plan = await previewUnenroll("lead1");

    expect(plan.effects.join(" ")).not.toContain("package amount");
    expect(plan.retained.join(" ")).toContain("cannot be restored");
  });
});

describe("unenrollLead — refusals", () => {
  it("refuses once the revenue has left My Drafts, and writes nothing", async () => {
    const tx = setup({ draftRow: null, draftDiscarded: false });

    await expect(run()).rejects.toMatchObject({ status: 400, code: "revenue_committed" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.leadPulsePipeline.update).not.toHaveBeenCalled();
  });

  it("proceeds when the draft was merely discarded by the reviewer", async () => {
    const tx = setup({ draftRow: null, draftDiscarded: true });

    await expect(run()).resolves.toMatchObject({ draftDiscarded: false });
    expect(tx.leadPulsePipeline.update).toHaveBeenCalled();
  });

  it("refuses when the lead is not Enrolled", async () => {
    setup({ statusCode: "follow_up" });
    await expect(run()).rejects.toMatchObject({ status: 400, code: "not_enrolled" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to land the lead in an action-only status", async () => {
    setup();
    fn(prisma.crmLeadStatus.findUnique).mockResolvedValue({
      id: "st-pipe",
      code: "pipeline",
      label: "Pipeline",
      active: true,
    });
    await expect(run({ toStatusId: "st-pipe" })).rejects.toMatchObject({ code: "action_only_status" });
  });

  it("refuses an inactive / unknown target status", async () => {
    setup();
    fn(prisma.crmLeadStatus.findUnique).mockResolvedValue(null);
    await expect(run({ toStatusId: "nope" })).rejects.toMatchObject({ code: "invalid_status" });
  });

  it("demands an explicit acknowledgement when Operations has worked the project", async () => {
    setup({ opsCounts: { taskCount: 12, touched: 4, docs: 0, items: 0 } });
    await expect(run()).rejects.toMatchObject({ code: "acknowledgement_required" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("aborts inside the transaction if another admin un-enrolled first", async () => {
    const tx = setup();
    tx.lead.findUnique.mockResolvedValue({ id: "lead1", status: { code: "follow_up", label: "Follow-Up" } });

    await expect(run()).rejects.toMatchObject({ code: "not_enrolled" });
    expect(tx.lead.update).not.toHaveBeenCalled();
  });
});

describe("unenrollLead — the reversal itself", () => {
  it("deletes the daily close, decrements closedWon, then clears dailyCloseId", async () => {
    const tx = setup({ close: { id: "close1", entry: { id: "entry1", closedWon: 3 } } });

    const res = await run();

    expect(tx.leadPulseDailyClose.delete).toHaveBeenCalledWith({ where: { id: "close1" } });
    expect(tx.leadPulseDailyEntry.update).toHaveBeenCalledWith({
      where: { id: "entry1" },
      data: { closedWon: 2 },
    });
    // dailyCloseId is only nulled alongside the reversal — never blindly, which
    // would orphan a close that then counts in the forecast forever.
    expect(tx.leadPulsePipeline.update).toHaveBeenCalledWith({
      where: { id: "pipe1" },
      data: { status: "open", closedDate: null, dailyCloseId: null },
    });
    expect(res.dailyCloseReversed).toBe(true);
  });

  it("floors closedWon at zero rather than going negative", async () => {
    const tx = setup({ close: { id: "close1", entry: { id: "entry1", closedWon: 0 } } });
    await run();
    expect(tx.leadPulseDailyEntry.update).toHaveBeenCalledWith({
      where: { id: "entry1" },
      data: { closedWon: 0 },
    });
  });

  it("still re-opens the pipeline when the close row has already gone", async () => {
    const tx = setup({ close: null });
    const res = await run();
    expect(tx.leadPulseDailyEntry.update).not.toHaveBeenCalled();
    expect(tx.leadPulsePipeline.update).toHaveBeenCalled();
    expect(res.dailyCloseReversed).toBe(false);
  });

  it("discards the pending revenue draft and moves the lead to the chosen status", async () => {
    const tx = setup();
    const res = await run({ reason: "enrolled by mistake" });

    expect(tx.transactionDraft.delete).toHaveBeenCalledWith({ where: { id: "draft1" } });
    expect(tx.lead.update).toHaveBeenCalledWith({ where: { id: "lead1" }, data: { statusId: "st-follow" } });
    expect(res.draftDiscarded).toBe(true);
    expect(res.toStatusLabel).toBe("Follow-Up");
  });

  it("deletes an untouched operations project so a later real enrollment rebuilds it", async () => {
    const tx = setup({ opsCounts: { taskCount: 12, touched: 0, docs: 0, items: 0 } });
    const res = await run();

    // createProjectForEnrollment is idempotent on partyServiceId — a cancelled
    // shell would make the next genuine enrollment silently skip the project.
    expect(tx.opsProject.delete).toHaveBeenCalledWith({ where: { id: "proj1" } });
    expect(tx.opsProject.update).not.toHaveBeenCalled();
    expect(res.opsProjectDeleted).toBe(true);
  });

  it("cancels (never deletes) a project Operations has already worked, and keeps its PartyService", async () => {
    const tx = setup({ opsCounts: { taskCount: 12, touched: 4, docs: 1, items: 0 } });
    const res = await run({ acknowledge: true });

    expect(tx.opsProject.update).toHaveBeenCalledWith({ where: { id: "proj1" }, data: { status: "cancelled" } });
    expect(tx.opsProject.delete).not.toHaveBeenCalled();
    // Deleting the PartyService cascades the project — exactly the history we
    // just chose to keep.
    expect(tx.partyService.delete).not.toHaveBeenCalled();
    expect(res.opsProjectCancelled).toBe(true);
  });

  it("removes the package amount this enrollment created", async () => {
    const tx = setup();
    const res = await run();
    expect(tx.partyService.delete).toHaveBeenCalledWith({ where: { id: "ps1" } });
    expect(res.partyServiceDeleted).toBe(true);
  });

  it("leaves a package amount that pre-dates the enrollment alone", async () => {
    const tx = setup({ partyService: { id: "ps1", createdAt: new Date("2026-01-01T00:00:00.000Z") } });
    const res = await run();
    expect(tx.partyService.delete).not.toHaveBeenCalled();
    expect(res.partyServiceDeleted).toBe(false);
  });

  it("never touches an operations project belonging to a different lead", async () => {
    const tx = setup({ opsProject: { id: "proj1", status: "active", leadId: "otherLead" } });
    const res = await run();
    expect(tx.opsProject.delete).not.toHaveBeenCalled();
    expect(tx.opsProject.update).not.toHaveBeenCalled();
    expect(res.opsProjectDeleted).toBe(false);
    expect(res.opsProjectCancelled).toBe(false);
  });
});
