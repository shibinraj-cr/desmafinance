import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  crmDailyReport: { findMany: vi.fn(), upsert: vi.fn() },
  crmLeadAssignment: { findMany: vi.fn(async () => []) },
  crmLeadHandover: { findMany: vi.fn(async () => []) },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const roster = vi.hoisted(() => ({
  bdes: [
    { userId: "u1", displayName: "BDE A", username: "a", role: "l2" },
    { userId: "u2", displayName: "BDE B", username: "b", role: "l1" },
  ],
}));
vi.mock("@/lib/crm-leads", () => ({ getAssignableBdes: vi.fn(async () => roster.bdes) }));
const activity = vi.hoisted(() => vi.fn(async () => ({ metrics: { contacts: 2 }, details: { notes: [] } })));
vi.mock("@/lib/crm-daily-report", async (orig) => ({
  ...(await orig<typeof import("@/lib/crm-daily-report")>()),
  computeDailyReport: activity,
}));

import { generateDayReports } from "@/lib/crm-lead-report-data";

const now = new Date("2026-11-16T11:30:00.000Z"); // Mon 17:00 IST

beforeEach(() => {
  vi.clearAllMocks();
  db.crmDailyReport.findMany.mockResolvedValue([]);
  db.crmDailyReport.upsert.mockResolvedValue({});
});

describe("generateDayReports", () => {
  it("generates and locks a report for every active BDE — nobody submits anything", async () => {
    expect(await generateDayReports("2026-11-16", now)).toBe(2);
    const first = db.crmDailyReport.upsert.mock.calls[0][0];
    expect(first.where).toEqual({ userId_day: { userId: "u1", day: new Date("2026-11-16T00:00:00.000Z") } });
    expect(first.create).toMatchObject({
      userId: "u1",
      status: "submitted",
      summary: "",
      locked: true,
      submittedAt: now,
      metrics: { contacts: 2 },
      leadReport: { day: "2026-11-16", totals: { received: 0 } },
    });
  });

  it("keeps remarks a BDE added before the cutoff — only the numbers are written", async () => {
    db.crmDailyReport.findMany.mockResolvedValue([{ userId: "u1", locked: false }]);
    await generateDayReports("2026-11-16", now);
    const { update } = db.crmDailyReport.upsert.mock.calls[0][0];
    expect(update).toMatchObject({ locked: true });
    expect(update).not.toHaveProperty("summary");
    expect(update).not.toHaveProperty("blockers");
  });

  it("skips a day already generated", async () => {
    db.crmDailyReport.findMany.mockResolvedValue([{ userId: "u1", locked: true }]);
    expect(await generateDayReports("2026-11-16", now)).toBe(1);
    expect(db.crmDailyReport.upsert.mock.calls.map((c) => c[0].where.userId_day.userId)).toEqual(["u2"]);
  });

  it("one BDE failing doesn't stop the rest", async () => {
    activity.mockRejectedValueOnce(new Error("boom"));
    expect(await generateDayReports("2026-11-16", now)).toBe(1);
    expect(db.crmDailyReport.upsert).toHaveBeenCalledTimes(1);
  });
});
