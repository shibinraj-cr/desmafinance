/**
 * The target sheet's incentive APIs: "Minimum & slabs" (slabs, minimum,
 * bonuses) and "Teams" (create / rename / retire, and a month's members and
 * targets). Prisma is mocked; the routes and the incentive engine run for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => {
  const d = {
    leadPulseRole: { findMany: vi.fn() },
    leadPulseIncentive: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    leadPulseIncentiveMonth: { findUnique: vi.fn(), upsert: vi.fn() },
    leadPulseTeam: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    leadPulseTeamMember: { findMany: vi.fn(), count: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    leadPulseTeamTarget: { upsert: vi.fn(), deleteMany: vi.fn() },
    leadPulseAuditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  d.$transaction.mockImplementation(async (fn: (tx: typeof d) => Promise<unknown>) => fn(d));
  return d;
});
const access = vi.hoisted(() => ({ current: { canSupervise: true, desfinAdmin: false } }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(async () => ({ userId: "sup1", perms: { isAdmin: false } })),
}));
vi.mock("@/lib/lead-pulse-rbac", () => ({ getLeadPulseAccess: vi.fn(async () => access.current) }));
vi.mock("@/lib/lead-pulse-dates", () => ({ todayIst: () => "2026-11-10" }));

import { POST as saveIncentive } from "@/app/api/marketing/lead-pulse/incentive/route";
import { PATCH as patchTeam, POST as createTeam, PUT as saveTeams } from "@/app/api/marketing/lead-pulse/incentive/teams/route";

const req = (method: string, body: unknown) =>
  new NextRequest("http://x/api", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const EMPTY = Array.from({ length: 4 }, () => ({ from: null, rate: null }));
const slabs = (...s: Array<[number, number]>) => [...s.map(([from, rate]) => ({ from, rate })), ...EMPTY].slice(0, 4);

beforeEach(() => {
  vi.clearAllMocks();
  access.current = { canSupervise: true, desfinAdmin: false };
  db.leadPulseRole.findMany.mockResolvedValue([{ userId: "bde_a" }]);
  db.leadPulseIncentive.findUnique.mockResolvedValue(null);
  db.leadPulseIncentiveMonth.findUnique.mockResolvedValue(null);
  db.leadPulseTeam.findFirst.mockResolvedValue(null);
  db.leadPulseTeamMember.findMany.mockResolvedValue([]);
  db.leadPulseTeamMember.count.mockResolvedValue(0);
});

describe("POST /incentive — minimum, slabs and bonuses", () => {
  const body = (p: Record<string, unknown> = {}) => ({
    year: 2026,
    month: 11,
    rows: [{ userId: "bde_a", minimum: 8, slabs: slabs([10, 1000], [16, 1500]) }],
    ...p,
  });

  it("is for supervisors only", async () => {
    access.current = { canSupervise: false, desfinAdmin: false };
    const res = await saveIncentive(req("POST", body()));
    expect(res.status).toBe(403);
    expect(db.leadPulseIncentive.upsert).not.toHaveBeenCalled();
  });

  it("saves an L2 BDE's minimum and slabs, and the month's bonuses, with an audit row each", async () => {
    const res = await saveIncentive(
      req("POST", body({ bonuses: { targetBonus: 5000, fastCloseBonus: 250, referralBonus: 100 } })),
    );
    expect(res.status).toBe(200);
    expect(db.leadPulseIncentive.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { year_month_userId: { year: 2026, month: 11, userId: "bde_a" } },
        create: expect.objectContaining({ minimum: 8, slab1From: 10, slab1Rate: 1000, slab2From: 16, slab2Rate: 1500, slab3From: null }),
      }),
    );
    expect(db.leadPulseIncentiveMonth.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ targetBonus: 5000, fastCloseBonus: 250, referralBonus: 100 }) }),
    );
    expect(db.leadPulseAuditLog.create).toHaveBeenCalledTimes(2);
  });

  it("refuses slabs that break the rules, naming the problem", async () => {
    const res = await saveIncentive(req("POST", body({ rows: [{ userId: "bde_a", minimum: 8, slabs: slabs([16, 1500], [10, 1000]) }] })));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/Slab 2 must start higher than slab 1/);
    expect(db.leadPulseIncentive.upsert).not.toHaveBeenCalled();
  });

  it("refuses anyone who isn't an L2 BDE", async () => {
    db.leadPulseRole.findMany.mockResolvedValue([]);
    const res = await saveIncentive(req("POST", body()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_l2_bde");
  });

  it("clearing every field deletes the BDE's setup", async () => {
    db.leadPulseIncentive.findUnique.mockResolvedValue({ id: "row", minimum: 8, slab1From: 10, slab1Rate: 1000 });
    const res = await saveIncentive(req("POST", body({ rows: [{ userId: "bde_a", minimum: null, slabs: EMPTY }] })));
    expect(res.status).toBe(200);
    expect(db.leadPulseIncentive.delete).toHaveBeenCalled();
    expect(db.leadPulseIncentive.upsert).not.toHaveBeenCalled();
  });

  it("a closed month is admin-only", async () => {
    const october = body({ month: 10 });
    expect((await saveIncentive(req("POST", october))).status).toBe(403);
    expect(db.leadPulseIncentive.upsert).not.toHaveBeenCalled();

    access.current = { canSupervise: true, desfinAdmin: true };
    expect((await saveIncentive(req("POST", october))).status).toBe(200);
    expect(db.leadPulseIncentive.upsert).toHaveBeenCalled();
  });
});

describe("teams", () => {
  it("creates a team, refusing a name already taken (any case)", async () => {
    db.leadPulseTeam.create.mockResolvedValue({ id: "t1", name: "Alpha", active: true });
    expect((await createTeam(req("POST", { name: "Alpha" }))).status).toBe(200);

    db.leadPulseTeam.findFirst.mockResolvedValue({ id: "t1" });
    const res = await createTeam(req("POST", { name: "alpha" }));
    expect(res.status).toBe(409);
  });

  it("won't retire a team that still has BDEs this month or later", async () => {
    db.leadPulseTeam.findUnique.mockResolvedValue({ id: "t1", name: "Alpha", active: true });
    db.leadPulseTeamMember.count.mockResolvedValue(2);
    const res = await patchTeam(req("PATCH", { id: "t1", active: false }));
    expect(res.status).toBe(409);
    expect(db.leadPulseTeam.update).not.toHaveBeenCalled();
    expect(db.leadPulseTeamMember.count).toHaveBeenCalledWith({
      where: { teamId: "t1", OR: [{ year: { gt: 2026 } }, { year: 2026, month: { gte: 11 } }] },
    });
  });

  describe("PUT — one month's members and targets", () => {
    const month = (teams: unknown[]) => ({ year: 2026, month: 11, teams });

    beforeEach(() => {
      db.leadPulseTeam.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
        ["alpha", "beta"].filter((id) => where.id.in.includes(id)).map((id) => ({ id })),
      );
      db.leadPulseRole.findMany.mockResolvedValue([{ userId: "bde_a" }, { userId: "bde_b" }]);
    });

    it("replaces the month's membership and sets or clears each target", async () => {
      const res = await saveTeams(
        req(
          "PUT",
          month([
            { teamId: "alpha", userIds: ["bde_a", "bde_b"], month: { target: 30, pool: 15000 }, quarter: null },
            { teamId: "beta", userIds: [], month: null, quarter: { target: 70, pool: 30000 } },
          ]),
        ),
      );
      expect(res.status).toBe(200);
      expect(db.leadPulseTeamMember.deleteMany).toHaveBeenCalledWith({ where: { year: 2026, month: 11 } });
      expect(db.leadPulseTeamMember.createMany).toHaveBeenCalledWith({
        data: [
          { teamId: "alpha", userId: "bde_a", year: 2026, month: 11 },
          { teamId: "alpha", userId: "bde_b", year: 2026, month: 11 },
        ],
      });
      expect(db.leadPulseTeamTarget.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { teamId_year_periodType_period: { teamId: "alpha", year: 2026, periodType: "month", period: 11 } },
          create: expect.objectContaining({ target: 30, pool: 15000 }),
        }),
      );
      // November is in quarter 4.
      expect(db.leadPulseTeamTarget.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { teamId_year_periodType_period: { teamId: "beta", year: 2026, periodType: "quarter", period: 4 } },
        }),
      );
      expect(db.leadPulseTeamTarget.deleteMany).toHaveBeenCalledWith({
        where: { teamId: "alpha", year: 2026, periodType: "quarter", period: 4 },
      });
    });

    it("refuses a BDE in two teams", async () => {
      const res = await saveTeams(
        req(
          "PUT",
          month([
            { teamId: "alpha", userIds: ["bde_a"], month: null, quarter: null },
            { teamId: "beta", userIds: ["bde_a"], month: null, quarter: null },
          ]),
        ),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("member_in_two_teams");
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("adds only active L2 BDEs, but keeps a member who has since left", async () => {
      db.leadPulseRole.findMany.mockResolvedValue([{ userId: "bde_a" }]);
      const withLeaver = month([{ teamId: "alpha", userIds: ["bde_a", "gone"], month: null, quarter: null }]);
      const refused = await saveTeams(req("PUT", withLeaver));
      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toBe("not_l2_bde");

      db.leadPulseTeamMember.findMany.mockResolvedValue([{ userId: "gone" }]);
      expect((await saveTeams(req("PUT", withLeaver))).status).toBe(200);
    });

    it("a closed month is admin-only", async () => {
      const october = { year: 2026, month: 10, teams: [] };
      expect((await saveTeams(req("PUT", october))).status).toBe(403);
      access.current = { canSupervise: true, desfinAdmin: true };
      expect((await saveTeams(req("PUT", october))).status).toBe(200);
    });
  });
});
