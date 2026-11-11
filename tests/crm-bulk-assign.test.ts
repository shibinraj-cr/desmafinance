/**
 * Bulk "Assign to BDE" on the Leads list: POST /api/crm/leads/bulk-assign.
 * Every lead goes through assignLeadTo (mocked here), so these tests pin the
 * route's own job — the gate, the up-front assignee check, and what it skips.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError, badRequest, notFound } from "@/lib/http-error";

const db = vi.hoisted(() => ({
  leadPulseRole: { findUnique: vi.fn() },
  lead: { findMany: vi.fn() },
}));
const access = vi.hoisted(() => ({ canAssign: true }));
const assignLeadTo = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(async () => ({
    userId: "ma1",
    perms: { isAdmin: false, canApprove: false, needsApproval: false, draftFirst: false, pages: ["/crm/leads"], roleName: "Marketing Admin" },
  })),
}));
vi.mock("@/lib/crm-rbac", () => ({ getCrmAccess: vi.fn(async () => access) }));
vi.mock("@/lib/crm-assign", () => ({ assignLeadTo }));

import { POST } from "@/app/api/crm/leads/bulk-assign/route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/crm/leads/bulk-assign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  access.canAssign = true;
  db.leadPulseRole.findUnique.mockResolvedValue({ role: "l2", active: true, displayName: "BDE One" });
  assignLeadTo.mockResolvedValue({});
});

describe("POST /api/crm/leads/bulk-assign", () => {
  it("assigns each lead through the single-lead path and counts new vs reassigned", async () => {
    db.lead.findMany.mockResolvedValue([
      { id: "a", assignedToId: null },
      { id: "b", assignedToId: "bde-old" },
    ]);
    const res = await POST(req({ leadIds: ["a", "b"], assignedToId: "bde1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ requested: 2, assigned: 1, reassigned: 1, skippedUnchanged: 0, assigneeName: "BDE One" });
    expect(assignLeadTo).toHaveBeenCalledTimes(2);
    expect(assignLeadTo).toHaveBeenCalledWith("a", "bde1", "ma1");
    expect(assignLeadTo).toHaveBeenCalledWith("b", "bde1", "ma1");
  });

  it("is refused to anyone who can't assign a single lead", async () => {
    access.canAssign = false;
    const res = await POST(req({ leadIds: ["a"], assignedToId: "bde1" }));
    expect(res.status).toBe(403);
    expect(db.lead.findMany).not.toHaveBeenCalled();
  });

  it("rejects an assignee who isn't an active L1/L2 BDE before touching any lead", async () => {
    db.leadPulseRole.findUnique.mockResolvedValue({ role: "supervisor", active: true, displayName: "Boss" });
    const res = await POST(req({ leadIds: ["a"], assignedToId: "boss" }));
    expect(res.status).toBe(400);
    expect(assignLeadTo).not.toHaveBeenCalled();
  });

  it("skips leads already with that BDE, central-pool revivals to the last owner, and stale ids", async () => {
    db.lead.findMany.mockResolvedValue([
      { id: "same", assignedToId: "bde1" },
      { id: "pool", assignedToId: null },
      { id: "gone", assignedToId: null },
      { id: "ok", assignedToId: null },
    ]);
    assignLeadTo.mockImplementation(async (id: string) => {
      if (id === "pool") throw badRequest("revive to someone else", "same_owner_revival");
      if (id === "gone") throw notFound();
      return {};
    });
    const res = await POST(req({ leadIds: ["same", "pool", "gone", "ok", "missing"], assignedToId: "bde1" }));
    expect(await res.json()).toMatchObject({
      requested: 5,
      assigned: 1,
      reassigned: 0,
      skippedUnchanged: 1,
      skippedRevival: 1,
      skippedMissing: 2,
    });
    // "Already with them" never reaches assignLeadTo — no second notification.
    expect(assignLeadTo).not.toHaveBeenCalledWith("same", expect.anything(), expect.anything());
  });

  it("dedupes repeated ids", async () => {
    db.lead.findMany.mockResolvedValue([{ id: "a", assignedToId: null }]);
    const res = await POST(req({ leadIds: ["a", "a"], assignedToId: "bde1" }));
    expect(await res.json()).toMatchObject({ requested: 1, assigned: 1, skippedMissing: 0 });
    expect(assignLeadTo).toHaveBeenCalledTimes(1);
  });

  it("stops on an unexpected failure so the client can retry from that chunk", async () => {
    db.lead.findMany.mockResolvedValue([{ id: "a", assignedToId: null }]);
    assignLeadTo.mockRejectedValue(new HttpError(409, "conflict", "conflict"));
    const res = await POST(req({ leadIds: ["a"], assignedToId: "bde1" }));
    expect(res.status).toBe(409);
  });

  it("caps a request at 50 leads", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `l${i}`);
    const res = await POST(req({ leadIds: ids, assignedToId: "bde1" }));
    expect(res.status).toBe(400);
  });
});
