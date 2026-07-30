import { describe, it, expect, vi } from "vitest";

// crm-leads imports prisma at module load. The functions under test are pure, so
// mock prisma to avoid constructing a real DB client when the module loads.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  resolveAssigneeFilter,
  buildLeadWhere,
  buildCrmTaskWhere,
  requiresNextStepOnComplete,
  crmTaskFollowAssignmentWhere,
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

describe("buildLeadWhere — free-text search (q)", () => {
  it("searches email ONLY for a query with an @ (no phone-digit leak)", () => {
    // Regression: "srisubha1703@gmail.com" used to reduce to "1703" and match
    // every number stored as "91703…", flooding results with unrelated leads.
    const or = buildLeadWhere({ q: "srisubha1703@gmail.com" }).OR as Array<Record<string, unknown>>;
    expect(or).toEqual([{ email: { contains: "srisubha1703@gmail.com", mode: "insensitive" } }]);
    // No phone/phoneE164 clause is present.
    expect(or.some((c) => "phoneE164" in c || "phone" in c)).toBe(false);
  });

  it("searches name + email + phone for a plain text query", () => {
    const or = buildLeadWhere({ q: "srisubha" }).OR as Array<Record<string, unknown>>;
    expect(or).toContainEqual({ candidateName: { contains: "srisubha", mode: "insensitive" } });
    expect(or).toContainEqual({ email: { contains: "srisubha", mode: "insensitive" } });
  });

  it("does NOT run a digit phone-match for a mostly-alphabetic query with a few digits", () => {
    // "srisubha1703" (partial email, no @) is 33% digits — not phone-like, so the
    // bare-digit "1703" clause must not appear.
    const or = buildLeadWhere({ q: "srisubha1703" }).OR as Array<Record<string, unknown>>;
    expect(or.some((c) => JSON.stringify(c).includes('"contains":"1703"'))).toBe(false);
  });

  it("runs a format-agnostic digit phone-match for a phone-like query", () => {
    const or = buildLeadWhere({ q: "+91 78142 95082" }).OR as Array<Record<string, unknown>>;
    expect(or).toContainEqual({ phoneE164: { contains: "917814295082" } });
  });

  it("omits the OR when no query is given", () => {
    expect(buildLeadWhere({}).OR).toBeUndefined();
  });
});

describe("buildLeadWhere — age → dob range", () => {
  const now = new Date("2026-07-09T00:00:00.000Z");

  it("translates a min age to a dob upper bound", () => {
    const where = buildLeadWhere({ ageMin: 25, now });
    expect(where.dob).toEqual({ lte: new Date(Date.UTC(2001, 6, 9)) });
  });

  it("translates a max age to a dob lower bound", () => {
    const where = buildLeadWhere({ ageMax: 30, now });
    expect(where.dob).toEqual({ gte: new Date(Date.UTC(1995, 6, 10)) });
  });

  it("translates a min+max age range to both dob bounds", () => {
    const where = buildLeadWhere({ ageMin: 25, ageMax: 30, now });
    expect(where.dob).toEqual({
      gte: new Date(Date.UTC(1995, 6, 10)),
      lte: new Date(Date.UTC(2001, 6, 9)),
    });
  });

  it("omits the dob filter when no age bound is given", () => {
    expect(buildLeadWhere({ now }).dob).toBeUndefined();
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

describe("crmTaskFollowAssignmentWhere — tasks that follow a lead (re)assignment", () => {
  it("sweeps only the unassigned pool when the lead had no prior owner", () => {
    // Assigning an unassigned lead: its null-owned re-inquiry tasks must move so
    // they leave the Tasks board's "Unassigned" filter. Nothing else is touched.
    expect(crmTaskFollowAssignmentWhere(null)).toEqual({ assignedToId: null });
  });

  it("sweeps unassigned tasks AND the outgoing owner's tasks on reassignment", () => {
    // Reassigning A→B moves tasks owned by A and any unassigned tasks, but leaves
    // tasks owned by anyone else (e.g. a supervisor's oversight copy) alone.
    expect(crmTaskFollowAssignmentWhere("bde-A")).toEqual({
      OR: [{ assignedToId: null }, { assignedToId: "bde-A" }],
    });
  });

  it("never matches a third party's tasks (no bare unconditional match)", () => {
    // Guard against a where that would grab every open task regardless of owner.
    const where = crmTaskFollowAssignmentWhere("bde-A");
    const owners = "OR" in where ? where.OR : [where];
    expect(owners).not.toContainEqual({});
  });
});
