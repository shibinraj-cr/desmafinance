import { describe, it, expect, vi } from "vitest";

// crm-leads imports prisma at module load. The functions under test are pure, so
// mock prisma to avoid constructing a real DB client when the module loads.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  resolveAssigneeFilter,
  buildLeadWhere,
  buildCrmTaskWhere,
  requiresNextStepOnComplete,
} from "@/lib/crm-leads";

describe("requiresNextStepOnComplete — mandatory next step on an active lead", () => {
  it("requires a next step when completing an active lead's last open task", () => {
    expect(requiresNextStepOnComplete({ completing: true, leadKind: "active", remainingOpenTasks: 0 })).toBe(true);
  });

  it("does not require one when another open task remains", () => {
    expect(requiresNextStepOnComplete({ completing: true, leadKind: "active", remainingOpenTasks: 1 })).toBe(false);
  });

  it("exempts won and lost leads", () => {
    expect(requiresNextStepOnComplete({ completing: true, leadKind: "won", remainingOpenTasks: 0 })).toBe(false);
    expect(requiresNextStepOnComplete({ completing: true, leadKind: "lost", remainingOpenTasks: 0 })).toBe(false);
  });

  it("does not fire on a reopen / non-completion", () => {
    expect(requiresNextStepOnComplete({ completing: false, leadKind: "active", remainingOpenTasks: 0 })).toBe(false);
  });
});

describe("resolveAssigneeFilter", () => {
  it("defaults a BDE with no explicit choice to their own queue", () => {
    expect(resolveAssigneeFilter(undefined, { isBde: true, userId: "u1" })).toBe("u1");
  });

  it("leaves non-BDEs unfiltered by default (sees all leads)", () => {
    expect(resolveAssigneeFilter(undefined, { isBde: false, userId: "u1" })).toBeUndefined();
  });

  it("respects an explicit consultant id over the BDE default", () => {
    expect(resolveAssigneeFilter("u2", { isBde: true, userId: "u1" })).toBe("u2");
  });

  it("respects the explicit 'all' opt-out so a BDE can view everyone", () => {
    expect(resolveAssigneeFilter("all", { isBde: true, userId: "u1" })).toBe("all");
  });

  it("respects an explicit 'unassigned' choice", () => {
    expect(resolveAssigneeFilter("unassigned", { isBde: true, userId: "u1" })).toBe("unassigned");
  });
});

describe("buildLeadWhere — assignee", () => {
  it("restricts to a consultant id", () => {
    expect(buildLeadWhere({ assignee: "u1" }).assignedToId).toBe("u1");
  });

  it("matches only unassigned leads for 'unassigned'", () => {
    expect(buildLeadWhere({ assignee: "unassigned" }).assignedToId).toBeNull();
  });

  it("applies no assignee filter for the 'all' sentinel", () => {
    expect(buildLeadWhere({ assignee: "all" }).assignedToId).toBeUndefined();
  });

  it("applies no assignee filter when omitted", () => {
    expect(buildLeadWhere({}).assignedToId).toBeUndefined();
  });
});

describe("buildLeadWhere — country", () => {
  it("filters by an exact country name", () => {
    expect(buildLeadWhere({ country: "Australia" }).country).toBe("Australia");
  });

  it("omits the country filter when not provided", () => {
    expect(buildLeadWhere({}).country).toBeUndefined();
  });
});

describe("buildCrmTaskWhere — re-inquiry kind", () => {
  it("matches re-inquiry follow-ups by subject (case-insensitive)", () => {
    // Catches every creator: 'Re-inquiry — …', 'Re-inquiry oversight — …', and
    // the rescue script's 'Re-engage — re-inquiry via …'.
    expect(buildCrmTaskWhere({ kind: "reinquiry" }).subject).toEqual({
      contains: "re-inquiry",
      mode: "insensitive",
    });
  });

  it("applies no subject filter for other kinds", () => {
    expect(buildCrmTaskWhere({}).subject).toBeUndefined();
    expect(buildCrmTaskWhere({ kind: "other" }).subject).toBeUndefined();
  });

  it("combines the re-inquiry kind with the default open status", () => {
    const where = buildCrmTaskWhere({ kind: "reinquiry", status: "open" });
    expect(where.status).toBe("open");
    expect(where.subject).toEqual({ contains: "re-inquiry", mode: "insensitive" });
  });
});

describe("buildCrmTaskWhere — assignee", () => {
  it("scopes to a specific consultant", () => {
    expect(buildCrmTaskWhere({ assignee: "u1" }).assignedToId).toBe("u1");
  });
  it("matches the unassigned pool", () => {
    expect(buildCrmTaskWhere({ assignee: "unassigned" }).assignedToId).toBeNull();
  });
  it("treats the 'all' sentinel as no assignee filter (the BDE opt-out)", () => {
    expect("assignedToId" in buildCrmTaskWhere({ assignee: "all" })).toBe(false);
  });
  it("applies no assignee filter when omitted", () => {
    expect("assignedToId" in buildCrmTaskWhere({})).toBe(false);
  });
});
