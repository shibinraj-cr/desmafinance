/**
 * POST /api/crm/integrations { action: "set_routes" } — saving the lead sheets'
 * "Auto-assign by tab" rules. A rule that can never work (a consultant
 * assignLeadTo would refuse, a second rule for the same tab) is refused here,
 * at save time, rather than failing silently on every lead later.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  service: { findMany: vi.fn() },
  leadImportBatch: { findMany: vi.fn() },
}));
const settings = vi.hoisted(() => ({ store: new Map<string, string>() }));
const access = vi.hoisted(() => ({ canManageSettings: true }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(async () => ({ userId: "admin1", perms: { isAdmin: true, pages: [] } })),
}));
vi.mock("@/lib/crm-rbac", () => ({ getCrmAccess: vi.fn(async () => access) }));
vi.mock("@/lib/crm-leads", () => ({
  getAssignableBdes: vi.fn(async () => [{ userId: "bde-sa", displayName: "BDE SA", username: "bde.sa", role: "l2" }]),
}));
vi.mock("@/lib/app-settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/app-settings")>()),
  getSetting: vi.fn(async (k: string) => settings.store.get(k) ?? null),
  setSetting: vi.fn(async (k: string, v: string) => void settings.store.set(k, v)),
}));

import { POST } from "@/app/api/crm/integrations/route";
import { SHEET_LEADS_ROUTES_KEY } from "@/lib/app-settings";

const TAB = "GF | Nursing  | Study Abroad | Plus Two | AUG 24";

function req(body: unknown): Request {
  return new Request("http://localhost/api/crm/integrations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.store.clear();
  access.canManageSettings = true;
  db.service.findMany.mockResolvedValue([{ id: "svc-sa", name: "Study Abroad" }]);
  db.leadImportBatch.findMany.mockResolvedValue([{ fileName: `Meta: ${TAB}` }, { fileName: "Website (SEO): Sheet1" }]);
});

describe("POST /api/crm/integrations set_routes", () => {
  it("stores the rules and returns them with the editor's choices", async () => {
    const res = await POST(
      req({ action: "set_routes", routes: [{ source: "meta", campaign: TAB, assigneeUserId: "bde-sa", serviceId: "svc-sa" }] }),
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(settings.store.get(SHEET_LEADS_ROUTES_KEY)!)).toEqual([
      { source: "meta", campaign: TAB, assigneeUserId: "bde-sa", serviceId: "svc-sa" },
    ]);
    const body = await res.json();
    expect(body.routes).toHaveLength(1);
    expect(body.routeOptions.tabs).toEqual({ meta: [TAB], website: ["Sheet1"] });
    expect(body.routeOptions.bdes).toEqual([{ userId: "bde-sa", displayName: "BDE SA", role: "l2" }]);
  });

  it("clears every rule when given an empty list", async () => {
    settings.store.set(SHEET_LEADS_ROUTES_KEY, JSON.stringify([{ source: "meta", campaign: TAB, assigneeUserId: "bde-sa" }]));
    const res = await POST(req({ action: "set_routes", routes: [] }));
    expect(res.status).toBe(200);
    expect(settings.store.get(SHEET_LEADS_ROUTES_KEY)).toBe("[]");
  });

  it("refuses a consultant who is not an active L1/L2", async () => {
    const res = await POST(req({ action: "set_routes", routes: [{ source: "meta", campaign: TAB, assigneeUserId: "supervisor" }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_assignee");
    expect(settings.store.has(SHEET_LEADS_ROUTES_KEY)).toBe(false);
  });

  it("refuses two rules for the same tab, however it is spaced", async () => {
    const res = await POST(
      req({
        action: "set_routes",
        routes: [
          { source: "meta", campaign: TAB, assigneeUserId: "bde-sa" },
          { source: "meta", campaign: "gf | nursing | study abroad | plus two | aug 24", assigneeUserId: "bde-sa" },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("duplicate_route");
  });

  it("refuses an unknown source or an inactive service", async () => {
    const bad1 = await POST(req({ action: "set_routes", routes: [{ source: "tiktok", campaign: "X", assigneeUserId: "bde-sa" }] }));
    expect((await bad1.json()).error).toBe("unknown_source");
    const bad2 = await POST(
      req({ action: "set_routes", routes: [{ source: "meta", campaign: "X", assigneeUserId: "bde-sa", serviceId: "svc-gone" }] }),
    );
    expect((await bad2.json()).error).toBe("invalid_service");
  });

  it("is admin-only, like the rest of Lead capture", async () => {
    access.canManageSettings = false;
    const res = await POST(req({ action: "set_routes", routes: [] }));
    expect(res.status).toBe(403);
  });
});
