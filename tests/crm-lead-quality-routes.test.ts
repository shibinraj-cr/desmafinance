/**
 * The lead-quality rule as the API enforces it: the lead PATCH (rating, stage
 * moves, closing), the task-complete route, and Enroll. Prisma is mocked; the
 * routes and the rule modules run for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  lead: { findUnique: vi.fn(), update: vi.fn() },
  crmLeadStatus: { findFirst: vi.fn() },
  crmLeadQualityReason: { findFirst: vi.fn() },
  crmTask: { findUnique: vi.fn(), count: vi.fn() },
}));
const access = vi.hoisted(() => ({ current: { isAdmin: false, isSupervisor: false, isBde: true } as Record<string, unknown> }));
const user = vi.hoisted(() => ({ id: "bde1" }));
const activity = vi.hoisted(() => vi.fn());
const enroll = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(async () => ({ userId: user.id, perms: { isAdmin: false } })),
}));
vi.mock("@/lib/crm-rbac", () => ({
  getCrmAccess: vi.fn(async () => ({ canViewLeads: true, ...access.current })),
  canEditLead: vi.fn(() => true),
}));
vi.mock("@/lib/crm-activity", () => ({ recordLeadActivity: activity }));
vi.mock("@/lib/crm-remarketing", () => ({ openRemarketingCampaign: vi.fn(), stopRemarketingCampaigns: vi.fn() }));
vi.mock("@/lib/crm-enroll", () => ({ syncPipelineToLeadStatus: vi.fn(), enrollLead: enroll }));
vi.mock("@/lib/crm-reinquiry", () => ({ REMARKETING_STATUS_CODE: "re_marketing" }));
vi.mock("@/lib/crm-assign", () => ({ assignLeadTo: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/crm-task-reminders-engine", () => ({
  armTaskReminders: vi.fn(),
  cancelTaskReminders: vi.fn(),
  armedChannelsFor: vi.fn(async () => []),
  getTaskReminderConfig: vi.fn(async () => ({ enabled: false, defaultChannels: [], consultantIds: [] })),
  TASK_REMINDER_CHANNELS: ["whatsapp", "email"],
}));

import { PATCH as patchLead } from "@/app/api/crm/leads/[id]/route";
import { PATCH as patchTask } from "@/app/api/crm/leads/[id]/tasks/[taskId]/route";
import { POST as enrollRoute } from "@/app/api/crm/leads/[id]/enroll/route";

const DAY = 86_400_000;
const STAGES = {
  follow_up: { id: "st_follow", code: "follow_up", label: "Follow Up", kind: "active", active: true },
  not_interested: { id: "st_lost", code: "not_interested", label: "Not Interested", kind: "lost", active: true },
  qualify: { id: "st_qualify", code: "qualify", label: "Qualify", kind: "active", active: true },
};

/** A lead as the PATCH route reads it: owned by bde1, unrated, in Follow Up. */
function existingLead(p: Record<string, unknown> = {}) {
  return {
    id: "lead1",
    candidateName: "Test Candidate",
    email: null,
    phone: null,
    altPhone: null,
    sourceId: null,
    serviceId: null,
    qualificationId: null,
    qualificationOther: null,
    statusId: STAGES.follow_up.id,
    subStatusId: null,
    partyId: null,
    dob: null,
    country: null,
    studyDestination: null,
    temperature: null,
    extra: null,
    assignedToId: "bde1",
    qualityRating: null,
    qualityReasonId: null,
    qualityNote: null,
    qualityDueAt: new Date(Date.now() - DAY), // overdue
    status: { id: STAGES.follow_up.id, label: "Follow Up", code: "follow_up" },
    subStatus: null,
    ...p,
  };
}

/** The include-shaped row `serializeLead` turns into the response. */
function updatedRow(data: Record<string, unknown>) {
  const now = new Date();
  return {
    ...existingLead(),
    ...data,
    phoneE164: null,
    altPhoneE164: null,
    createdAt: now,
    lastActivityAt: now,
    subStatusSince: null,
    assignedAt: null,
    campaign: null,
    expectedValue: null,
    expectedCloseDate: null,
    dedupeKey: null,
    importBatchId: null,
    qualityRatedAt: null,
    source: null,
    service: null,
    qualification: null,
    status: { id: STAGES.follow_up.id, code: "follow_up", label: "Follow Up", kind: "active", color: null },
    subStatus: null,
    assignedTo: { id: "bde1", username: "bde1", leadPulseRole: null },
    party: null,
    pipeline: null,
    qualityReason: null,
    qualityRatedBy: null,
  };
}

const req = (body: unknown) => new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) });
const ctx = { params: { id: "lead1" } };

beforeEach(() => {
  vi.clearAllMocks();
  user.id = "bde1";
  access.current = { isAdmin: false, isSupervisor: false, isBde: true };
  db.lead.findUnique.mockResolvedValue(existingLead());
  db.lead.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => updatedRow(data));
  db.crmLeadStatus.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
    Object.values(STAGES).find((s) => s.id === where.id) ?? null,
  );
  db.crmLeadQualityReason.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === "r_wrong" ? { id: "r_wrong", label: "Wrong / invalid number" } : null,
  );
});

describe("lead PATCH — the stage gate", () => {
  it("refuses an overdue lead's own BDE a stage move, and writes nothing", async () => {
    const res = await patchLead(req({ statusId: STAGES.qualify.id }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("quality_required");
    expect(db.lead.update).not.toHaveBeenCalled();
  });

  it("lets the same move through when the rating comes with it, and logs the rating", async () => {
    const res = await patchLead(req({ statusId: STAGES.qualify.id, quality: { rating: "good" } }), ctx);
    expect(res.status).toBe(200);
    const data = db.lead.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ statusId: STAGES.qualify.id, qualityRating: "good", qualityReasonId: null, qualityRatedById: "bde1" });
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ type: "QUALITY_RATED", summary: "Quality: Not rated → Good" }));
  });

  it("asks for the rating when closing a lead before it was even due", async () => {
    db.lead.findUnique.mockResolvedValue(existingLead({ qualityDueAt: new Date(Date.now() + 3 * DAY) }));
    const res = await patchLead(req({ statusId: STAGES.not_interested.id }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).message).toMatch(/before you close it/);
  });

  it("does not ask before day 5 for a move between active stages", async () => {
    db.lead.findUnique.mockResolvedValue(existingLead({ qualityDueAt: new Date(Date.now() + 3 * DAY) }));
    const res = await patchLead(req({ statusId: STAGES.qualify.id }), ctx);
    expect(res.status).toBe(200);
  });

  it("never holds a supervisor working someone else's lead", async () => {
    user.id = "sup1";
    access.current = { isAdmin: false, isSupervisor: true, isBde: false };
    const res = await patchLead(req({ statusId: STAGES.not_interested.id }), ctx);
    expect(res.status).toBe(200);
  });

  it("leaves pre-rule leads (no due date) alone", async () => {
    db.lead.findUnique.mockResolvedValue(existingLead({ qualityDueAt: null }));
    const res = await patchLead(req({ statusId: STAGES.not_interested.id }), ctx);
    expect(res.status).toBe(200);
  });
});

describe("lead PATCH — rating", () => {
  it("requires a reason for Junk", async () => {
    const res = await patchLead(req({ quality: { rating: "junk" } }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("quality_reason_required");
  });

  it("rejects an unknown or inactive reason", async () => {
    const res = await patchLead(req({ quality: { rating: "junk", reasonId: "r_gone" } }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_quality_reason");
  });

  it("saves Junk with its reason and a trimmed note", async () => {
    const res = await patchLead(req({ quality: { rating: "junk", reasonId: "r_wrong", note: "  number belongs to someone else " } }), ctx);
    expect(res.status).toBe(200);
    expect(db.lead.update.mock.calls[0][0].data).toMatchObject({
      qualityRating: "junk",
      qualityReasonId: "r_wrong",
      qualityNote: "number belongs to someone else",
    });
    expect(activity).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "Quality: Not rated → Junk (Wrong / invalid number)" }),
    );
  });

  it("drops a reason sent with Good, so an upgraded lead can't keep 'Fake' behind it", async () => {
    db.lead.findUnique.mockResolvedValue(existingLead({ qualityRating: "junk", qualityReasonId: "r_wrong" }));
    await patchLead(req({ quality: { rating: "good", reasonId: "r_wrong" } }), ctx);
    expect(db.lead.update.mock.calls[0][0].data).toMatchObject({ qualityRating: "good", qualityReasonId: null });
  });

  it("writes nothing when the rating is unchanged", async () => {
    db.lead.findUnique
      .mockResolvedValueOnce(existingLead({ qualityRating: "average" }))
      .mockResolvedValueOnce(updatedRow({ qualityRating: "average" }));
    const res = await patchLead(req({ quality: { rating: "average" } }), ctx);
    expect(res.status).toBe(200);
    expect(db.lead.update).not.toHaveBeenCalled();
    expect(activity).not.toHaveBeenCalled();
  });
});

describe("task completion — the overdue gate", () => {
  function task(lead: Record<string, unknown>) {
    return {
      id: "t1",
      leadId: "lead1",
      subject: "Call",
      status: "open",
      dueAt: null,
      priority: "normal",
      note: null,
      assignedToId: "bde1",
      lead: {
        id: "lead1",
        assignedToId: "bde1",
        qualityRating: null,
        qualityDueAt: new Date(Date.now() - DAY),
        status: { kind: "active", code: "follow_up", parked: false },
        ...lead,
      },
    };
  }
  const taskCtx = { params: { id: "lead1", taskId: "t1" } };

  it("refuses the lead's own BDE completing a task while the rating is overdue", async () => {
    db.crmTask.findUnique.mockResolvedValue(task({}));
    const res = await patchTask(req({ status: "done" }), taskCtx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("quality_required");
  });

  it("falls through to the usual next-step rule once the lead is rated", async () => {
    db.crmTask.findUnique.mockResolvedValue(task({ qualityRating: "good" }));
    db.crmTask.count.mockResolvedValue(0);
    const res = await patchTask(req({ status: "done" }), taskCtx);
    expect((await res.json()).error).toBe("next_task_required");
  });
});

describe("Enroll — closing asks for the rating", () => {
  const enrollReq = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body) });
  const enrollLead = (p: Record<string, unknown> = {}) => ({
    id: "lead1",
    assignedToId: "bde1",
    qualityRating: null,
    qualityReasonId: null,
    qualityNote: null,
    qualityDueAt: new Date(Date.now() + 2 * DAY),
    status: { code: "follow_up" },
    ...p,
  });

  it("refuses an unrated tracked lead, and never reaches the enrollment", async () => {
    db.lead.findUnique.mockResolvedValue(enrollLead());
    const res = await enrollRoute(enrollReq({ serviceId: "s1" }), ctx);
    expect(res.status).toBe(422);
    expect(enroll).not.toHaveBeenCalled();
  });

  it("saves the rating, then enrolls", async () => {
    db.lead.findUnique.mockResolvedValue(enrollLead());
    db.lead.update.mockResolvedValue({});
    enroll.mockResolvedValue({ partyId: "p1", pipelineId: "pl1", draftId: null, opsProjectId: null });
    const res = await enrollRoute(enrollReq({ serviceId: "s1", quality: { rating: "good" } }), ctx);
    expect(res.status).toBe(200);
    expect(db.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ qualityRating: "good" }) }),
    );
    expect(enroll).toHaveBeenCalled();
  });

  it("enrolls a lead that is already rated without asking again", async () => {
    db.lead.findUnique.mockResolvedValue(enrollLead({ qualityRating: "average" }));
    enroll.mockResolvedValue({ partyId: "p1", pipelineId: "pl1", draftId: null, opsProjectId: null });
    const res = await enrollRoute(enrollReq({ serviceId: "s1" }), ctx);
    expect(res.status).toBe(200);
    expect(db.lead.update).not.toHaveBeenCalled();
  });
});
