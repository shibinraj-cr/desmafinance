import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  crmLeadAssignment: { groupBy: vi.fn() },
  crmLeadHandover: { groupBy: vi.fn(), findUnique: vi.fn() },
  crmNotification: { findMany: vi.fn(), createMany: vi.fn() },
  user: { findMany: vi.fn() },
  holiday: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const steps = vi.hoisted(() => ({
  syncAssignments: vi.fn(async () => ({ opened: 1, closed: 0 })),
  evaluateAssignments: vi.fn(async () => 3),
  markOverdueHandovers: vi.fn(async () => 2),
  linkArrivedLeads: vi.fn(async () => 0),
  generateDayReports: vi.fn(async (_day: string, _now?: Date) => 0),
}));
const start = vi.hoisted(() => ({ at: null as Date | null }));
vi.mock("@/lib/crm-contact-data", () => ({
  syncAssignments: steps.syncAssignments,
  evaluateAssignments: steps.evaluateAssignments,
  leadReportStart: vi.fn(async () => start.at),
}));
vi.mock("@/lib/crm-handover-data", () => ({
  markOverdueHandovers: steps.markOverdueHandovers,
  linkArrivedLeads: steps.linkArrivedLeads,
}));
const admins = vi.hoisted(() => ({ ids: ["ma1", "ma2"] }));
vi.mock("@/lib/crm-notify", () => ({ marketingAdminUserIds: vi.fn(async () => admins.ids) }));
vi.mock("@/lib/crm-lead-report-data", () => ({ generateDayReports: steps.generateDayReports }));

import {
  notifyHandoverRejected,
  notifyHandoversSaved,
  runLeadCutoffTick,
  sendCutoffReminders,
  sendCutoffSummary,
} from "@/lib/crm-lead-cutoff-data";
import { GET as cronGet } from "@/app/api/cron/lead-cutoff/route";

const ist = (dateTime: string) => new Date(`${dateTime.replace(" ", "T")}:00+05:30`);
const cutoff = ist("2026-11-16 17:00");

beforeEach(() => {
  vi.clearAllMocks();
  admins.ids = ["ma1", "ma2"];
  db.holiday.findMany.mockResolvedValue([]);
  db.crmNotification.findMany.mockResolvedValue([]);
  db.crmLeadAssignment.groupBy.mockResolvedValue([]);
  db.crmLeadHandover.groupBy.mockResolvedValue([]);
  db.user.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id, username: id, leadPulseRole: { displayName: id.toUpperCase() } })),
  );
});

describe("runLeadCutoffTick", () => {
  it("runs every step and reports what it did", async () => {
    const out = await runLeadCutoffTick(ist("2026-11-16 11:00"));
    expect(out).toMatchObject({ opened: 1, judged: 3, overdue: 2, linked: 0, reminders: 0, summaries: 0, errors: [] });
  });

  it("keeps going when a step fails", async () => {
    steps.syncAssignments.mockRejectedValueOnce(new Error("boom"));
    const out = await runLeadCutoffTick(ist("2026-11-16 11:00"));
    expect(out.errors).toEqual(["sync: boom"]);
    expect(steps.evaluateAssignments).toHaveBeenCalled();
    expect(steps.markOverdueHandovers).toHaveBeenCalled();
  });

  it("generates today's reports once the cutoff passes — BDEs submit nothing", async () => {
    steps.generateDayReports.mockResolvedValue(3);
    await runLeadCutoffTick(ist("2026-11-16 16:55")); // Monday, before the cutoff; Sunday had none
    expect(steps.generateDayReports).not.toHaveBeenCalled();
    const out = await runLeadCutoffTick(ist("2026-11-16 17:00"));
    expect(steps.generateDayReports).toHaveBeenCalledWith("2026-11-16", ist("2026-11-16 17:00"));
    expect(out.reports).toBe(3);
  });

  it("catches up the day before, if it had a cutoff", async () => {
    await runLeadCutoffTick(ist("2026-11-17 09:00")); // Tuesday morning → Monday
    expect(steps.generateDayReports.mock.calls.map((c) => c[0])).toEqual(["2026-11-16"]);
    steps.generateDayReports.mockClear();
    db.holiday.findMany.mockResolvedValue([{ date: new Date("2026-11-16T00:00:00Z") }]); // Monday a holiday
    await runLeadCutoffTick(ist("2026-11-17 09:00"));
    expect(steps.generateDayReports).not.toHaveBeenCalled();
  });

  it("never catches up a day before tracking began", async () => {
    start.at = ist("2026-11-17 08:00"); // went live Tuesday morning
    await runLeadCutoffTick(ist("2026-11-17 09:00"));
    expect(steps.generateDayReports).not.toHaveBeenCalled();
    start.at = null;
  });

  it("reminds only in the hour before the cutoff, and not on Sunday", async () => {
    db.crmLeadAssignment.groupBy.mockResolvedValue([{ userId: "b1", _count: { _all: 2 } }]);
    expect((await runLeadCutoffTick(ist("2026-11-16 16:10"))).reminders).toBe(1);
    expect((await runLeadCutoffTick(ist("2026-11-15 16:10"))).reminders).toBe(0);
  });
});

describe("sendCutoffReminders", () => {
  it("one per BDE with leads or handovers due today, combined", async () => {
    db.crmLeadAssignment.groupBy.mockResolvedValue([{ userId: "b1", _count: { _all: 2 } }]);
    db.crmLeadHandover.groupBy.mockResolvedValue([
      { assignedBdeId: "b1", _count: { _all: 1 } },
      { assignedBdeId: "b2", _count: { _all: 1 } },
    ]);
    expect(await sendCutoffReminders("2026-11-16", cutoff)).toBe(2);
    const data = db.crmNotification.createMany.mock.calls[0][0].data;
    expect(data.find((d: { userId: string }) => d.userId === "b1").body).toMatch(/^2 leads and 1 handover/);
    expect(data.find((d: { userId: string }) => d.userId === "b2").body).toMatch(/^1 handover/);
  });

  it("goes once a day", async () => {
    db.crmLeadAssignment.groupBy.mockResolvedValue([{ userId: "b1", _count: { _all: 2 } }]);
    db.crmNotification.findMany.mockResolvedValue([{ userId: "b1" }]);
    expect(await sendCutoffReminders("2026-11-16", cutoff)).toBe(0);
    expect(db.crmNotification.createMany).not.toHaveBeenCalled();
  });
});

describe("sendCutoffSummary", () => {
  it("sends the Marketing Admin the misses and overdue handovers per BDE", async () => {
    db.crmLeadAssignment.groupBy.mockResolvedValue([{ userId: "b1", _count: { _all: 2 } }]);
    db.crmLeadHandover.groupBy.mockResolvedValue([{ assignedBdeId: "b2", _count: { _all: 1 } }]);
    expect(await sendCutoffSummary("2026-11-16", cutoff)).toBe(2);
    const first = db.crmNotification.createMany.mock.calls[0][0].data[0];
    expect(first).toMatchObject({
      kind: "lead_cutoff_summary",
      title: "5:00 pm cutoff: 2 missed leads, 1 overdue handover",
      body: "B1 — 2 missed\nB2 — 1 handover overdue",
      linkUrl: "/crm/report?date=2026-11-16",
    });
  });

  it("stays quiet on a clean day, and goes once a day", async () => {
    expect(await sendCutoffSummary("2026-11-16", cutoff)).toBe(0);
    db.crmLeadAssignment.groupBy.mockResolvedValue([{ userId: "b1", _count: { _all: 1 } }]);
    db.crmNotification.findMany.mockResolvedValue([{ userId: "ma1" }, { userId: "ma2" }]);
    expect(await sendCutoffSummary("2026-11-16", cutoff)).toBe(0);
    expect(db.crmNotification.createMany).not.toHaveBeenCalled();
  });
});

describe("handover notifications", () => {
  const base = { leadName: "Asha", dueAt: cutoff, existingOwnerId: null, linkedLeadId: null };

  it("tells the BDE about new handovers", async () => {
    await notifyHandoversSaved({
      saved: [{ ...base, id: "h1", phoneE164: "+919876543210", status: "pending" }],
      channel: "walk_in",
      assignedBdeId: "b1",
      actorId: "ma1",
      now: ist("2026-11-16 10:00"),
    });
    expect(db.crmNotification.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ userId: "b1", kind: "handover_assigned", title: "New handover: Asha (+919876543210)" }),
    ]);
  });

  it("a duplicate tells the Marketing Admin, the BDE and the other owner — not the person who saved it", async () => {
    await notifyHandoversSaved({
      saved: [{ ...base, id: "h1", phoneE164: "+919876543210", status: "duplicate", existingOwnerId: "b2", linkedLeadId: "lead-1" }],
      channel: "walk_in",
      assignedBdeId: "b1",
      actorId: "ma1",
    });
    const data = db.crmNotification.createMany.mock.calls[0][0].data;
    expect(data.map((d: { userId: string }) => d.userId).sort()).toEqual(["b1", "b2", "ma2"]);
    expect(data[0]).toMatchObject({ kind: "handover_duplicate", linkUrl: "/crm/leads/lead-1", leadId: "lead-1" });
    expect(data[0].body).toBe("Asha (+919876543210) — handed to B1; already a lead, owned by B2");
  });

  it("a rejection tells the Marketing Admin", async () => {
    db.crmLeadHandover.findUnique.mockResolvedValue({
      leadName: "Asha",
      phone: "98765 43210",
      assignedBdeId: "b1",
      rejectReason: "not_nurse_lead",
      rejectNote: null,
    });
    await notifyHandoverRejected("h1", "b1");
    const data = db.crmNotification.createMany.mock.calls[0][0].data;
    expect(data.map((d: { userId: string }) => d.userId)).toEqual(["ma1", "ma2"]);
    expect(data[0]).toMatchObject({ title: "Handover rejected: Asha", body: "B1 — Not a nurse lead · 98765 43210" });
  });

  it("never throws", async () => {
    db.crmNotification.createMany.mockRejectedValueOnce(new Error("db down"));
    await expect(
      notifyHandoversSaved({
        saved: [{ ...base, id: "h1", phoneE164: "+919876543210", status: "pending" }],
        channel: "walk_in",
        assignedBdeId: "b1",
        actorId: "ma1",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("cron route", () => {
  const req = (auth?: string) =>
    new Request("http://local/api/cron/lead-cutoff", auth ? { headers: { authorization: auth } } : undefined);

  it("is closed without CRON_SECRET, and needs the bearer", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await cronGet(req("Bearer x"))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await cronGet(req("Bearer wrong"))).status).toBe(401);
    const res = await cronGet(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, judged: 3 });
    vi.unstubAllEnvs();
  });
});
