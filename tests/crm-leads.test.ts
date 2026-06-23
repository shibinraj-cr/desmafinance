import { describe, it, expect, vi } from "vitest";

// crm-leads imports prisma at module load. The functions under test are pure, so
// mock prisma to avoid constructing a real DB client when the module loads.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { resolveAssigneeFilter, buildLeadWhere } from "@/lib/crm-leads";

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
