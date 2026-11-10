import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  crmLeadHandover: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    createManyAndReturn: vi.fn(),
  },
  lead: { findMany: vi.fn(), update: vi.fn() },
  leadPulseSource: { findUnique: vi.fn(), findFirst: vi.fn() },
  holiday: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const bde = vi.hoisted(() => ({ active: true }));
vi.mock("@/lib/crm-leads", () => ({ isActiveBde: vi.fn(async () => bde.active) }));
vi.mock("@/lib/crm-rbac", () => ({ getCrmAccess: vi.fn() }));

import {
  linkArrivedLeads,
  linkHandovers,
  markOverdueHandovers,
  rejectHandover,
  reopenHandover,
  saveHandovers,
} from "@/lib/crm-handover-data";

const ist = (dateTime: string) => new Date(`${dateTime.replace(" ", "T")}:00+05:30`);
const MANAGER = { canManage: true, viewScope: "all" as const };
const BDE_ACCESS = { canManage: false, viewScope: "own" as const };

beforeEach(() => {
  vi.clearAllMocks();
  bde.active = true;
  db.holiday.findMany.mockResolvedValue([]);
  db.crmLeadHandover.findMany.mockResolvedValue([]);
  db.lead.findMany.mockResolvedValue([]);
  db.crmLeadHandover.createManyAndReturn.mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) =>
    data.map((d, i) => ({ id: `h${i}`, ...d })),
  );
  db.crmLeadHandover.updateMany.mockResolvedValue({ count: 1 });
});

describe("saveHandovers", () => {
  const now = ist("2026-11-09 17:30");

  it("saves a new number as pending, due at the next cutoff, on today's IST date", async () => {
    const res = await saveHandovers({
      channel: "walk_in",
      assignedBdeId: "u1",
      rows: [{ leadName: " Asha ", phone: "98765 43210", note: "came to office" }],
      actorId: "ma",
      now,
    });
    expect(res.errors).toEqual([]);
    const data = db.crmLeadHandover.createManyAndReturn.mock.calls[0][0].data[0];
    expect(data).toMatchObject({
      handoverDate: new Date("2026-11-09T00:00:00.000Z"),
      channel: "walk_in",
      leadName: "Asha",
      phoneE164: "+919876543210",
      status: "pending",
      linkedLeadId: null,
      dueAt: ist("2026-11-10 17:00"),
      createdById: "ma",
    });
    expect(res.saved[0]).toMatchObject({ status: "pending", existingOwnerId: null });
  });

  it("a number that is already a lead is saved as a duplicate, linked, with its owner", async () => {
    db.lead.findMany.mockResolvedValue([
      { id: "lead-1", assignedToId: "u9", phoneE164: "+919412345678", altPhoneE164: null },
    ]);
    const res = await saveHandovers({
      channel: "youtube",
      assignedBdeId: "u1",
      rows: [{ phone: "094123 45678" }],
      actorId: "ma",
      now,
    });
    const data = db.crmLeadHandover.createManyAndReturn.mock.calls[0][0].data[0];
    expect(data).toMatchObject({ status: "duplicate", linkedLeadId: "lead-1", actionedAt: now, actionedById: "ma" });
    expect(res.saved[0]).toMatchObject({ status: "duplicate", linkedLeadId: "lead-1", existingOwnerId: "u9" });
  });

  it("matches an existing lead's alternate number too", async () => {
    db.lead.findMany.mockResolvedValue([
      { id: "lead-2", assignedToId: null, phoneE164: "+919000000000", altPhoneE164: "+919876543210" },
    ]);
    const res = await saveHandovers({ channel: "phone", assignedBdeId: "u1", rows: [{ phone: "9876543210" }], actorId: "ma", now });
    expect(res.saved[0]).toMatchObject({ status: "duplicate", linkedLeadId: "lead-2" });
  });

  it("returns rows it cannot save, and saves the rest", async () => {
    db.crmLeadHandover.findMany.mockResolvedValue([{ phoneE164: "+919000000001" }]);
    const res = await saveHandovers({
      channel: "other",
      assignedBdeId: "u1",
      rows: [{ phone: "12" }, { phone: "9000000001" }, { phone: "9123456780" }],
      actorId: "ma",
      now,
    });
    expect(res.errors).toEqual([
      { index: 0, phone: "12", reason: "Not a valid phone number" },
      { index: 1, phone: "9000000001", reason: "Already handed over and still open" },
    ]);
    expect(res.saved).toHaveLength(1);
  });

  it("refuses a BDE who is not an active L1/L2", async () => {
    bde.active = false;
    await expect(
      saveHandovers({ channel: "other", assignedBdeId: "u1", rows: [{ phone: "9123456780" }], actorId: "ma", now }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_assignee" });
  });
});

describe("linkHandovers", () => {
  it("only settles handovers that are still open", async () => {
    const now = new Date();
    await linkHandovers(["h1"], "lead-1", "created", "u1", now);
    expect(db.crmLeadHandover.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["h1"] }, status: { in: ["pending", "overdue"] } },
      data: { status: "created", linkedLeadId: "lead-1", actionedAt: now, actionedById: "u1" },
    });
  });

  it("does nothing for no handovers", async () => {
    expect(await linkHandovers([], "lead-1", "created", "u1")).toBe(0);
    expect(db.crmLeadHandover.updateMany).not.toHaveBeenCalled();
  });
});

describe("rejectHandover / reopenHandover", () => {
  beforeEach(() => db.crmLeadHandover.findUnique.mockResolvedValue({ id: "h1", status: "pending", assignedBdeId: "u1" }));

  it("the assigned BDE rejects with a reason", async () => {
    await rejectHandover({ id: "h1", access: BDE_ACCESS, actorId: "u1", reason: "invalid_number" });
    expect(db.crmLeadHandover.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "h1", status: { in: ["pending", "overdue"] } },
      data: { status: "rejected", rejectReason: "invalid_number", rejectNote: null, actionedById: "u1" },
    });
  });

  it("another BDE may not", async () => {
    await expect(
      rejectHandover({ id: "h1", access: BDE_ACCESS, actorId: "u2", reason: "invalid_number" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("'Other' needs a note", async () => {
    await expect(
      rejectHandover({ id: "h1", access: BDE_ACCESS, actorId: "u1", reason: "other", note: "  " }),
    ).rejects.toMatchObject({ code: "reject_note_required" });
  });

  it("a handover no longer open can't be rejected", async () => {
    db.crmLeadHandover.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      rejectHandover({ id: "h1", access: BDE_ACCESS, actorId: "u1", reason: "not_nurse_lead" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("only the Marketing Admin reopens, with a fresh deadline", async () => {
    await expect(reopenHandover({ id: "h1", access: BDE_ACCESS, actorId: "u1" })).rejects.toMatchObject({ status: 403 });
    const now = ist("2026-11-14 16:00"); // Saturday after the 15:30 cutoff
    await reopenHandover({ id: "h1", access: MANAGER, actorId: "ma", now });
    expect(db.crmLeadHandover.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "h1", status: "rejected" },
      data: { status: "pending", rejectReason: null, dueAt: ist("2026-11-16 17:00") },
    });
  });
});

describe("markOverdueHandovers (H3)", () => {
  it("moves pending handovers past their deadline to overdue, late for good", async () => {
    const now = new Date();
    await markOverdueHandovers(now);
    expect(db.crmLeadHandover.updateMany).toHaveBeenCalledWith({
      where: { status: "pending", dueAt: { lt: now } },
      data: { status: "overdue", isLate: true },
    });
  });
});

describe("linkArrivedLeads (H2 for leads from other routes)", () => {
  it("settles a handover whose number became the BDE's lead, and stamps its source", async () => {
    db.crmLeadHandover.findMany.mockResolvedValue([
      { id: "h1", phoneE164: "+919876543210", assignedBdeId: "u1", channel: "walk_in", createdAt: ist("2026-11-09 10:00") },
    ]);
    db.lead.findMany.mockResolvedValue([
      // Someone else's lead with the number is not this BDE's work.
      { id: "lead-x", assignedToId: "u2", phoneE164: "+919876543210", altPhoneE164: null, createdAt: ist("2026-11-09 11:00") },
      { id: "lead-1", assignedToId: "u1", phoneE164: "+919876543210", altPhoneE164: null, createdAt: ist("2026-11-09 12:00") },
    ]);
    db.leadPulseSource.findUnique.mockResolvedValue({ id: "src-walk-in" });
    expect(await linkArrivedLeads()).toBe(1);
    expect(db.crmLeadHandover.updateMany.mock.calls[0][0].data).toMatchObject({ status: "created", linkedLeadId: "lead-1" });
    expect(db.lead.update).toHaveBeenCalledWith({ where: { id: "lead-1" }, data: { sourceId: "src-walk-in" } });
  });

  it("an older lead is a duplicate and keeps its source", async () => {
    db.crmLeadHandover.findMany.mockResolvedValue([
      { id: "h1", phoneE164: "+919876543210", assignedBdeId: "u1", channel: "walk_in", createdAt: ist("2026-11-09 10:00") },
    ]);
    db.lead.findMany.mockResolvedValue([
      { id: "lead-1", assignedToId: "u1", phoneE164: null, altPhoneE164: "+919876543210", createdAt: ist("2026-11-01 09:00") },
    ]);
    await linkArrivedLeads();
    expect(db.crmLeadHandover.updateMany.mock.calls[0][0].data.status).toBe("duplicate");
    expect(db.lead.update).not.toHaveBeenCalled();
  });
});
