/**
 * Close the day (POST /api/crm/report) and admin unlock as the API enforces
 * them: a submitted day is locked, today can't be closed with leads still due
 * before the cutoff, and only an admin unlocks. Prisma and the report
 * calculations are mocked; the routes run for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { todayIst } from "@/lib/lead-pulse-dates";

const db = vi.hoisted(() => ({
  crmDailyReport: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
}));
const user = vi.hoisted(() => ({ id: "bde1", isAdmin: false }));
const close = vi.hoisted(() => ({ value: { ok: true } as Record<string, unknown> }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(async () => ({
    userId: user.id,
    perms: { isAdmin: user.isAdmin, canApprove: false, needsApproval: false, draftFirst: false, pages: [], roleName: "Test" },
  })),
}));
vi.mock("@/lib/crm-rbac", () => ({ getCrmAccess: vi.fn(async () => ({ isBde: true })) }));
vi.mock("@/lib/crm-daily-report", async (orig) => ({
  ...(await orig<typeof import("@/lib/crm-daily-report")>()),
  computeDailyReport: vi.fn(async () => ({ metrics: { contacts: 1 }, details: { notes: [] } })),
}));
vi.mock("@/lib/crm-lead-report-data", () => ({
  computeLeadReport: vi.fn(async () => ({ day: "d", totals: { pending: 0 }, sources: [], handovers: {} })),
  closeDayCheck: vi.fn(async () => close.value),
  leadReportJson: (r: unknown) => r,
}));

import { POST as submit } from "@/app/api/crm/report/route";
import { POST as unlock } from "@/app/api/crm/report/[id]/unlock/route";

const day = todayIst();
const submitReq = () =>
  new Request("http://local/api/crm/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ day, summary: "Closed my leads" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  user.id = "bde1";
  user.isAdmin = false;
  close.value = { ok: true };
  db.crmDailyReport.findUnique.mockResolvedValue(null);
  db.crmDailyReport.upsert.mockResolvedValue({ id: "r1", status: "submitted" });
});

describe("Close the day", () => {
  it("freezes the lead report and locks the day", async () => {
    const res = await submit(submitReq());
    expect(res.status).toBe(201);
    const args = db.crmDailyReport.upsert.mock.calls[0][0];
    expect(args.create).toMatchObject({ locked: true, leadReport: { totals: { pending: 0 } }, summary: "Closed my leads" });
    expect(args.update).toMatchObject({ locked: true, leadReport: { totals: { pending: 0 } } });
  });

  it("a submitted day is read-only until an admin unlocks it", async () => {
    db.crmDailyReport.findUnique.mockResolvedValue({ status: "submitted", locked: true });
    const res = await submit(submitReq());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("day_locked");
    expect(db.crmDailyReport.upsert).not.toHaveBeenCalled();
  });

  it("an unlocked day can be submitted again", async () => {
    db.crmDailyReport.findUnique.mockResolvedValue({ status: "submitted", locked: false });
    expect((await submit(submitReq())).status).toBe(201);
  });

  it("refuses to close today while leads are still due before the cutoff", async () => {
    close.value = { ok: false, leads: 2, handovers: 0, cutoff: "2026-11-16T11:30:00.000Z" };
    const res = await submit(submitReq());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("leads_pending");
    expect(body.message).toBe("Contact the 2 leads still due today first, or close the day after the 5:00 pm cutoff.");
    expect(db.crmDailyReport.upsert).not.toHaveBeenCalled();
  });
});

describe("Unlock", () => {
  const params = { params: { id: "r1" } };
  const req = () => new Request("http://local/api/crm/report/r1/unlock", { method: "POST" });

  it("is for admins only", async () => {
    expect((await unlock(req(), params)).status).toBe(403);
  });

  it("unlocks a submitted day and records who did it", async () => {
    user.id = "admin1";
    user.isAdmin = true;
    db.crmDailyReport.findUnique.mockResolvedValue({ id: "r1", status: "submitted", locked: true });
    expect((await unlock(req(), params)).status).toBe(200);
    expect(db.crmDailyReport.update.mock.calls[0][0]).toMatchObject({
      where: { id: "r1" },
      data: { locked: false, unlockedById: "admin1" },
    });
  });

  it("won't reopen a reviewed report", async () => {
    user.isAdmin = true;
    db.crmDailyReport.findUnique.mockResolvedValue({ id: "r1", status: "reviewed", locked: true });
    expect((await unlock(req(), params)).status).toBe(409);
  });
});
