/**
 * Tab routing for the lead sheets — "every lead from this tab goes to this
 * consultant". Pins the rule parsing/matching, who a routed batch's leads go
 * to (new or unowned → rule's consultant; a re-enquiry on a lead with no active
 * owner, or one resting in Re-marketing / Not Eligible → taken over; anything
 * an active consultant is working → stays put), and that a failure never
 * escapes into the sheet webhook.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  lead: { findMany: vi.fn(), update: vi.fn() },
  service: { findUnique: vi.fn() },
}));
const assignLeadTo = vi.hoisted(() => vi.fn());
const recordLeadActivity = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/crm-assign", () => ({ assignLeadTo }));
vi.mock("@/lib/crm-activity", () => ({ recordLeadActivity }));

import { campaignKey, parseSheetRoutes, findSheetRoute, applySheetRoute, decideRoute, isActiveBde, type SheetRoute } from "@/lib/crm-sheet-routes";

const TAB = "GF | Nursing  | Study Abroad | Plus Two | AUG 24"; // Meta's double space, as the sheet sends it
const ROUTE: SheetRoute = { source: "meta", campaign: TAB, assigneeUserId: "bde-sa", serviceId: "svc-sa" };

describe("campaignKey", () => {
  it("ignores case, edge spaces and runs of whitespace", () => {
    expect(campaignKey("  GF | Nursing  | Study Abroad ")).toBe("gf | nursing | study abroad");
    expect(campaignKey(TAB)).toBe(campaignKey("gf | nursing | study abroad | plus two | aug 24"));
  });
});

describe("parseSheetRoutes", () => {
  it("returns no rules for empty, malformed or non-list values", () => {
    expect(parseSheetRoutes(null)).toEqual([]);
    expect(parseSheetRoutes("")).toEqual([]);
    expect(parseSheetRoutes("{not json")).toEqual([]);
    expect(parseSheetRoutes('{"source":"meta"}')).toEqual([]);
  });

  it("drops entries missing a source, tab or consultant, and keeps the rest", () => {
    const raw = JSON.stringify([
      { source: "meta", campaign: "A", assigneeUserId: "u1" },
      { source: "meta", campaign: "", assigneeUserId: "u1" },
      { source: "meta", campaign: "B" },
      "junk",
      null,
    ]);
    expect(parseSheetRoutes(raw)).toEqual([{ source: "meta", campaign: "A", assigneeUserId: "u1", serviceId: null }]);
  });

  it("keeps the first rule when one tab is listed twice", () => {
    const raw = JSON.stringify([
      { source: "meta", campaign: "Tab  One", assigneeUserId: "first" },
      { source: "meta", campaign: "tab one", assigneeUserId: "second" },
      { source: "website", campaign: "tab one", assigneeUserId: "third" },
    ]);
    expect(parseSheetRoutes(raw).map((r) => r.assigneeUserId)).toEqual(["first", "third"]);
  });
});

describe("findSheetRoute", () => {
  const routes = [ROUTE, { source: "website", campaign: "Sheet1", assigneeUserId: "web", serviceId: null }];

  it("matches the exact tab even when the rule was typed with single spaces", () => {
    expect(findSheetRoute([{ ...ROUTE, campaign: "GF | Nursing | Study Abroad | Plus Two | AUG 24" }], "meta", TAB)).not.toBeNull();
  });

  it("does not match another tab that merely shares words", () => {
    expect(findSheetRoute(routes, "meta", "GF | Nursing  | Study Abroad | Plus Two | AUG 4")).toBeNull();
    expect(findSheetRoute(routes, "meta", "GF | EXP GCC NEW MAY 2026")).toBeNull();
  });

  it("is per source", () => {
    expect(findSheetRoute(routes, "website", TAB)).toBeNull();
    expect(findSheetRoute(routes, "website", "sheet1")?.assigneeUserId).toBe("web");
  });
});

describe("decideRoute", () => {
  const lead = (over: Partial<Parameters<typeof decideRoute>[1]>) => ({ ownerId: "bde-other", ownerIsActiveBde: true, fromStatusCode: "follow_up", ...over });

  it("assigns a lead nobody owns, whatever its stage", () => {
    expect(decideRoute(ROUTE, lead({ ownerId: null, ownerIsActiveBde: false, fromStatusCode: null }))).toBe("assign");
    expect(decideRoute(ROUTE, lead({ ownerId: null, ownerIsActiveBde: false, fromStatusCode: "duplicate" }))).toBe("assign");
  });

  it("takes a lead from an owner who is no longer an active BDE", () => {
    expect(decideRoute(ROUTE, lead({ ownerIsActiveBde: false }))).toBe("take_over");
  });

  it("takes a Re-marketing or Not Eligible lead even from an active BDE", () => {
    expect(decideRoute(ROUTE, lead({ fromStatusCode: "re_marketing" }))).toBe("take_over");
    expect(decideRoute(ROUTE, lead({ fromStatusCode: "not_eligible" }))).toBe("take_over");
  });

  it("leaves an active BDE's lead in any other stage — Not Interested included", () => {
    for (const code of ["follow_up", "not_yet_started", "not_interested", "already_processing_elsewhere", "duplicate"]) {
      expect(decideRoute(ROUTE, lead({ fromStatusCode: code }))).toBe("keep");
    }
    expect(decideRoute(ROUTE, lead({ fromStatusCode: null }))).toBe("keep");
  });

  it("does nothing when the rule's consultant already owns it", () => {
    expect(decideRoute(ROUTE, lead({ ownerId: "bde-sa", fromStatusCode: "re_marketing" }))).toBe("already_theirs");
  });
});

describe("isActiveBde", () => {
  it("needs a sign-in-able user who is an active L1/L2 on the roster", () => {
    expect(isActiveBde({ isActive: true, leadPulseRole: { active: true, role: "l2" } })).toBe(true);
    expect(isActiveBde({ isActive: true, leadPulseRole: { active: true, role: "l1" } })).toBe(true);
    expect(isActiveBde({ isActive: false, leadPulseRole: { active: true, role: "l2" } })).toBe(false);
    expect(isActiveBde({ isActive: true, leadPulseRole: { active: false, role: "l2" } })).toBe(false);
    expect(isActiveBde({ isActive: true, leadPulseRole: { active: true, role: "supervisor" } })).toBe(false);
    expect(isActiveBde({ isActive: true, leadPulseRole: null })).toBe(false);
    expect(isActiveBde(null)).toBe(false);
  });
});

describe("applySheetRoute", () => {
  const ACTIVE = { isActive: true, leadPulseRole: { active: true, role: "l2" } };
  const LEFT = { isActive: false, leadPulseRole: { active: true, role: "l2" } };
  const unowned = (id: string, serviceId: string | null = null) => ({ id, assignedToId: null, assignedTo: null, serviceId });
  const t = (leadId: string, fromStatusCode: string | null = null) => ({ leadId, fromStatusCode });

  beforeEach(() => {
    vi.clearAllMocks();
    db.service.findUnique.mockResolvedValue({ name: "Study Abroad", isStudyAbroad: true });
    db.lead.update.mockResolvedValue({});
    assignLeadTo.mockResolvedValue({});
    recordLeadActivity.mockResolvedValue(undefined);
  });

  it("assigns unowned leads to the rule's consultant as the system, after filling a blank service", async () => {
    db.lead.findMany.mockResolvedValue([unowned("new1")]);
    const out = await applySheetRoute(ROUTE, [t("new1")], TAB);
    expect(out).toEqual({ assigned: 1, takenOver: 0, leftWithOwner: 0, failed: 0 });
    expect(db.lead.update).toHaveBeenCalledWith({ where: { id: "new1" }, data: { serviceId: "svc-sa" } });
    expect(assignLeadTo).toHaveBeenCalledWith("new1", "bde-sa", null, { via: `auto-assign rule for tab "${TAB}"`, studyAbroadRule: true });
    // Service first, so the WhatsApp intro rules see a Study Abroad lead.
    expect(db.lead.update.mock.invocationCallOrder[0]).toBeLessThan(assignLeadTo.mock.invocationCallOrder[0]);
    expect(recordLeadActivity).toHaveBeenCalledWith(expect.objectContaining({ leadId: "new1", type: "FIELD_UPDATED", actorId: null }));
  });

  it("leaves a lead an active consultant is working where it is", async () => {
    db.lead.findMany.mockResolvedValue([
      { id: "owned", assignedToId: "bde-other", assignedTo: ACTIVE, serviceId: "svc-ahpra" },
      unowned("dead"),
    ]);
    const out = await applySheetRoute(ROUTE, [t("owned", "follow_up"), t("dead", "duplicate")], TAB);
    expect(out).toEqual({ assigned: 1, takenOver: 0, leftWithOwner: 1, failed: 0 });
    expect(assignLeadTo).toHaveBeenCalledTimes(1);
    expect(assignLeadTo).toHaveBeenCalledWith("dead", "bde-sa", null, expect.anything());
    expect(db.lead.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: "owned" } }));
  });

  it("takes over a Re-marketing / Not Eligible lead, and one whose owner left, saying why on the timeline", async () => {
    db.lead.findMany.mockResolvedValue([
      { id: "remkt", assignedToId: "bde-other", assignedTo: ACTIVE, serviceId: null },
      { id: "ne", assignedToId: "bde-other", assignedTo: ACTIVE, serviceId: "svc-ahpra" },
      { id: "orphan", assignedToId: "bde-gone", assignedTo: LEFT, serviceId: null },
    ]);
    const out = await applySheetRoute(ROUTE, [t("remkt", "re_marketing"), t("ne", "not_eligible"), t("orphan", "follow_up")], TAB);
    expect(out).toEqual({ assigned: 0, takenOver: 3, leftWithOwner: 0, failed: 0 });
    const via = (id: string) => (assignLeadTo.mock.calls.find((c) => c[0] === id)?.[3] as { via: string }).via;
    expect(via("remkt")).toContain("it was in Re-marketing");
    expect(via("ne")).toContain("it was Not Eligible");
    expect(via("orphan")).toContain("no longer an active BDE");
    // Blank service filled; an existing one kept.
    expect(db.lead.update).toHaveBeenCalledWith({ where: { id: "remkt" }, data: { serviceId: "svc-sa" } });
    expect(db.lead.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ne" } }));
    // …and the nursing intro is still held back for the lead that kept its nursing service.
    expect(assignLeadTo.mock.calls.find((c) => c[0] === "ne")?.[3]).toMatchObject({ studyAbroadRule: true });
  });

  it("only holds back the intro when the rule's service is Study Abroad", async () => {
    db.service.findUnique.mockResolvedValue({ name: "AHPRA OBA Pathway", isStudyAbroad: false });
    db.lead.findMany.mockResolvedValue([unowned("x")]);
    await applySheetRoute({ ...ROUTE, serviceId: "svc-ahpra" }, [t("x")], TAB);
    expect(assignLeadTo.mock.calls[0][3]).not.toHaveProperty("studyAbroadRule");
  });

  it("judges a lead by the first stage it was given — a later row sees the revived stage", async () => {
    db.lead.findMany.mockResolvedValue([{ id: "ni", assignedToId: "bde-other", assignedTo: ACTIVE, serviceId: null }]);
    // Not Interested revives to Re-marketing on the first row; the second row must not turn that into a take-over.
    const out = await applySheetRoute(ROUTE, [t("ni", "not_interested"), t("ni", "re_marketing")], TAB);
    expect(out).toEqual({ assigned: 0, takenOver: 0, leftWithOwner: 1, failed: 0 });
    expect(db.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["ni"] } } }));
    expect(assignLeadTo).not.toHaveBeenCalled();
  });

  it("leaves a lead the rule's consultant already owns untouched", async () => {
    db.lead.findMany.mockResolvedValue([{ id: "mine", assignedToId: "bde-sa", assignedTo: ACTIVE, serviceId: null }]);
    const out = await applySheetRoute(ROUTE, [t("mine", "re_marketing")], TAB);
    expect(out).toEqual({ assigned: 0, takenOver: 0, leftWithOwner: 1, failed: 0 });
    expect(assignLeadTo).not.toHaveBeenCalled();
    expect(db.lead.update).not.toHaveBeenCalled();
  });

  it("never overwrites a service the lead already has", async () => {
    db.lead.findMany.mockResolvedValue([unowned("x", "svc-ahpra")]);
    await applySheetRoute(ROUTE, [t("x")], TAB);
    expect(db.lead.update).not.toHaveBeenCalled();
    expect(assignLeadTo).toHaveBeenCalledWith("x", "bde-sa", null, expect.anything());
  });

  it("assigns without touching the service when the rule has none", async () => {
    db.lead.findMany.mockResolvedValue([unowned("x")]);
    await applySheetRoute({ ...ROUTE, serviceId: null }, [t("x")], TAB);
    expect(db.service.findUnique).not.toHaveBeenCalled();
    expect(db.lead.update).not.toHaveBeenCalled();
    expect(assignLeadTo).toHaveBeenCalledTimes(1);
  });

  it("counts a failed assignment and carries on with the rest — it never throws", async () => {
    db.lead.findMany.mockResolvedValue([unowned("a"), unowned("b")]);
    assignLeadTo.mockRejectedValueOnce(new Error("same_owner_revival"));
    const out = await applySheetRoute(ROUTE, [t("a"), t("b")], TAB);
    expect(out).toEqual({ assigned: 1, takenOver: 0, leftWithOwner: 0, failed: 1 });
  });

  it("reports every lead as failed, without throwing, when the lookup itself fails", async () => {
    db.lead.findMany.mockRejectedValue(new Error("db down"));
    await expect(applySheetRoute(ROUTE, [t("a"), t("b"), t("a")], TAB)).resolves.toEqual({ assigned: 0, takenOver: 0, leftWithOwner: 0, failed: 2 });
    expect(assignLeadTo).not.toHaveBeenCalled();
  });

  it("does nothing for an empty batch", async () => {
    expect(await applySheetRoute(ROUTE, [], TAB)).toEqual({ assigned: 0, takenOver: 0, leftWithOwner: 0, failed: 0 });
    expect(db.lead.findMany).not.toHaveBeenCalled();
  });
});
