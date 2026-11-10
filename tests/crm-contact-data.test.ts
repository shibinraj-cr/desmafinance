import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  crmLeadAssignment: {
    updateMany: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn((args: unknown) => args),
  },
  lead: { findMany: vi.fn() },
  leadActivity: { findMany: vi.fn() },
  holiday: { findMany: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const setting = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("@/lib/app-settings", () => ({ getSetting: vi.fn(async () => setting.value) }));

import { evaluateAssignments, recordAssignmentChange, syncAssignments } from "@/lib/crm-contact-data";

const ist = (dateTime: string) => new Date(`${dateTime.replace(" ", "T")}:00+05:30`);

beforeEach(() => {
  vi.clearAllMocks();
  db.holiday.findMany.mockResolvedValue([]);
  setting.value = null;
});

describe("recordAssignmentChange", () => {
  it("closes earlier open rows and opens one due at the next cutoff", async () => {
    const at = ist("2026-11-09 16:59");
    await recordAssignmentChange(at, [{ leadId: "L1", userId: "u1" }]);
    expect(db.crmLeadAssignment.updateMany).toHaveBeenCalledWith({
      where: { leadId: { in: ["L1"] }, endedAt: null, assignedAt: { lt: at } },
      data: { endedAt: at },
    });
    expect(db.crmLeadAssignment.createMany).toHaveBeenCalledWith({
      data: [{ leadId: "L1", userId: "u1", assignedAt: at, contactDueAt: ist("2026-11-09 17:00") }],
      skipDuplicates: true,
    });
  });

  it("uses the holiday calendar for the deadline", async () => {
    db.holiday.findMany.mockResolvedValue([{ date: new Date("2026-11-10T00:00:00Z") }]);
    await recordAssignmentChange(ist("2026-11-09 18:00"), [{ leadId: "L1", userId: "u1" }]);
    expect(db.crmLeadAssignment.createMany.mock.calls[0][0].data[0].contactDueAt).toEqual(ist("2026-11-11 17:00"));
  });

  it("a release only closes rows", async () => {
    await recordAssignmentChange(ist("2026-11-09 12:00"), [{ leadId: "L1", userId: null }]);
    expect(db.crmLeadAssignment.updateMany).toHaveBeenCalledTimes(1);
    expect(db.crmLeadAssignment.createMany).not.toHaveBeenCalled();
  });

  it("never throws — the assignment it follows has already happened", async () => {
    db.crmLeadAssignment.updateMany.mockRejectedValueOnce(new Error("db down"));
    await expect(recordAssignmentChange(new Date(), [{ leadId: "L1", userId: "u1" }])).resolves.toBeUndefined();
  });
});

describe("evaluateAssignments", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    leadId: "L1",
    userId: "u1",
    assignedAt: ist("2026-11-09 10:00"),
    contactDueAt: ist("2026-11-09 17:00"),
    endedAt: null,
    contactStatus: "pending",
    firstContactedAt: null,
    ...over,
  });
  const act = (type: string, at: string, metadata: unknown = null, actorId = "u1") => ({
    leadId: "L1",
    type,
    actorId,
    occurredAt: ist(at),
    metadata,
  });

  it("stores contacted with the time the pair completed", async () => {
    db.crmLeadAssignment.findMany.mockResolvedValue([row()]);
    db.leadActivity.findMany.mockResolvedValue([
      act("CALL_LOGGED", "2026-11-09 11:00", { outcome: "no_answer" }),
      act("NOTE_ADDED", "2026-11-09 11:10"),
    ]);
    const changed = await evaluateAssignments({ now: ist("2026-11-09 12:00") });
    expect(changed).toBe(1);
    expect(db.crmLeadAssignment.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { contactStatus: "contacted", firstContactedAt: ist("2026-11-09 11:10") },
    });
  });

  it("marks an uncontacted row missed after the cutoff", async () => {
    db.crmLeadAssignment.findMany.mockResolvedValue([row()]);
    db.leadActivity.findMany.mockResolvedValue([]);
    await evaluateAssignments({ now: ist("2026-11-09 17:05") });
    expect(db.crmLeadAssignment.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { contactStatus: "missed", firstContactedAt: null },
    });
  });

  it("turns a miss into contacted_late when the contact comes later", async () => {
    db.crmLeadAssignment.findMany.mockResolvedValue([row({ contactStatus: "missed" })]);
    db.leadActivity.findMany.mockResolvedValue([act("CALL_LOGGED", "2026-11-10 10:00", { note: "spoke" })]);
    await evaluateAssignments({ now: ist("2026-11-10 11:00") });
    expect(db.crmLeadAssignment.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { contactStatus: "contacted_late", firstContactedAt: ist("2026-11-10 10:00") },
    });
  });

  it("writes nothing when the verdict is unchanged", async () => {
    db.crmLeadAssignment.findMany.mockResolvedValue([row()]);
    db.leadActivity.findMany.mockResolvedValue([act("CALL_LOGGED", "2026-11-09 11:00")]);
    expect(await evaluateAssignments({ now: ist("2026-11-09 12:00") })).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("scopes to one BDE and only re-checks rows that can still change", async () => {
    db.crmLeadAssignment.findMany.mockResolvedValue([]);
    await evaluateAssignments({ userId: "u1", now: ist("2026-11-20 12:00") });
    const where = db.crmLeadAssignment.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.OR).toEqual([
      { contactStatus: "pending" },
      { contactStatus: "missed", assignedAt: { gte: ist("2026-11-06 12:00") } },
    ]);
  });
});

describe("syncAssignments", () => {
  it("does nothing until tracking has a start", async () => {
    expect(await syncAssignments(ist("2026-11-09 12:00"))).toEqual({ opened: 0, closed: 0 });
    expect(db.lead.findMany).not.toHaveBeenCalled();
  });

  it("opens a missing row and never looks back past the tracking start", async () => {
    setting.value = "2026-11-09T04:00:00Z"; // 09:30 IST
    db.lead.findMany.mockResolvedValue([{ id: "L1", assignedToId: "u1", assignedAt: ist("2026-11-09 10:00") }]);
    db.crmLeadAssignment.findMany.mockResolvedValue([]);
    const result = await syncAssignments(ist("2026-11-09 12:00"));
    expect(result).toEqual({ opened: 1, closed: 0 });
    expect(db.lead.findMany.mock.calls[0][0].where.assignedAt).toEqual({ gte: new Date("2026-11-09T04:00:00Z") });
    expect(db.crmLeadAssignment.createMany).toHaveBeenCalledWith({
      data: [{ leadId: "L1", userId: "u1", assignedAt: ist("2026-11-09 10:00"), contactDueAt: ist("2026-11-09 17:00") }],
      skipDuplicates: true,
    });
  });
});
