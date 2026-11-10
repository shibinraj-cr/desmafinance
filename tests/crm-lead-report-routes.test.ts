/**
 * Remarks on the daily report (POST /api/crm/report) as the API enforces them:
 * BDEs submit nothing — the report is generated at the cutoff — and remarks
 * never touch its numbers. Prisma and the activity snapshot are mocked; the
 * route runs for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { todayIst } from "@/lib/lead-pulse-dates";

const db = vi.hoisted(() => ({
  crmDailyReport: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
const crm = vi.hoisted(() => ({ isBde: true }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(async () => ({
    userId: "bde1",
    perms: { isAdmin: false, canApprove: false, needsApproval: false, draftFirst: false, pages: [], roleName: "Test" },
  })),
}));
vi.mock("@/lib/crm-rbac", () => ({ getCrmAccess: vi.fn(async () => crm) }));
vi.mock("@/lib/crm-daily-report", async (orig) => ({
  ...(await orig<typeof import("@/lib/crm-daily-report")>()),
  computeDailyReport: vi.fn(async () => ({ metrics: { contacts: 1 }, details: { notes: [] } })),
}));

import { POST as saveRemarks } from "@/app/api/crm/report/route";

const day = todayIst();
const req = (body: Record<string, unknown>) =>
  new Request("http://local/api/crm/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ day, ...body }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  crm.isBde = true;
  db.crmDailyReport.findUnique.mockResolvedValue(null);
  db.crmDailyReport.create.mockResolvedValue({ id: "r1" });
});

describe("Remarks on the daily report", () => {
  it("on a generated report, only the remarks change — never the numbers", async () => {
    db.crmDailyReport.findUnique.mockResolvedValue({ id: "r1", status: "submitted" });
    const res = await saveRemarks(req({ summary: "Two candidates waiting on OET" }));
    expect(res.status).toBe(200);
    const { data } = db.crmDailyReport.update.mock.calls[0][0];
    expect(data).toEqual({ summary: "Two candidates waiting on OET", blockers: null, planNext: null });
    expect(db.crmDailyReport.create).not.toHaveBeenCalled();
  });

  it("before the cutoff, remarks start an unlocked row the cutoff run generates over", async () => {
    const res = await saveRemarks(req({ blockers: "Need a callback slot" }));
    expect(res.status).toBe(201);
    const { data } = db.crmDailyReport.create.mock.calls[0][0];
    expect(data).toMatchObject({ userId: "bde1", summary: "", blockers: "Need a callback slot", locked: false });
    expect(data.leadReport).toBeUndefined();
  });

  it("everything is optional", async () => {
    expect((await saveRemarks(req({}))).status).toBe(201);
  });

  it("a reviewed report can't be changed", async () => {
    db.crmDailyReport.findUnique.mockResolvedValue({ id: "r1", status: "reviewed" });
    const res = await saveRemarks(req({ summary: "late note" }));
    expect(res.status).toBe(409);
    expect(db.crmDailyReport.update).not.toHaveBeenCalled();
  });

  it("only a BDE has a day report", async () => {
    crm.isBde = false;
    expect((await saveRemarks(req({ summary: "x" }))).status).toBe(403);
  });
});
