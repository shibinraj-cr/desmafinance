import { describe, it, expect, vi } from "vitest";

// crm-leads imports prisma at module load. The functions under test are pure, so
// mock prisma to avoid constructing a real DB client when the module loads.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  resolveAssigneeFilter,
  buildLeadWhere,
  buildCrmTaskWhere,
  crmTaskAssigneeScope,
  crmTaskFilterParamsFromQuery,
  dueDateRange,
  requiresNextStepOnComplete,
  crmTaskFollowAssignmentWhere,
  bulkStageSkipReason,
  isActionOnlyStatus,
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

  it("exempts a Re-marketing lead — the automated drip is the follow-up, so no manual task is forced", () => {
    expect(
      requiresNextStepOnComplete({
        completing: true,
        leadKind: "active",
        remainingOpenTasks: 0,
        statusCode: "re_marketing",
      }),
    ).toBe(false);
  });

  it("still fires for other active statuses when a status code is supplied", () => {
    expect(
      requiresNextStepOnComplete({
        completing: true,
        leadKind: "active",
        remainingOpenTasks: 0,
        statusCode: "follow_up",
      }),
    ).toBe(true);
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

describe("buildLeadWhere — multi-select filters", () => {
  it("keeps a single pick as an equality", () => {
    expect(buildLeadWhere({ status: ["s1"] }).statusId).toBe("s1");
    expect(buildLeadWhere({ country: "Australia" }).country).toBe("Australia");
  });

  it("turns several picks into an IN", () => {
    expect(buildLeadWhere({ status: ["s1", "s2"] }).statusId).toEqual({ in: ["s1", "s2"] });
    expect(buildLeadWhere({ country: ["India", "Nepal"] }).country).toEqual({ in: ["India", "Nepal"] });
  });

  it("drops unrecognised temperature codes but keeps the valid ones", () => {
    expect(buildLeadWhere({ temperature: ["hot", "nonsense", "cold"] }).temperature).toEqual({
      in: ["hot", "cold"],
    });
    expect(buildLeadWhere({ temperature: ["nonsense"] }).temperature).toBeUndefined();
  });

  it("ORs unassigned together with picked consultants", () => {
    const where = buildLeadWhere({ assignee: ["unassigned", "u1", "u2"] });
    expect(where.assignedToId).toBeUndefined();
    expect(where.AND).toEqual([
      { OR: [{ assignedToId: null }, { assignedToId: { in: ["u1", "u2"] } }] },
    ]);
  });

  it("lets an unassigned-only pick stay a plain null match", () => {
    expect(buildLeadWhere({ assignee: ["unassigned"] }).assignedToId).toBeNull();
  });

  it("treats 'all' anywhere in the selection as the no-filter opt-out", () => {
    const where = buildLeadWhere({ assignee: ["u1", "all"] });
    expect(where.assignedToId).toBeUndefined();
    expect(where.AND).toBeUndefined();
  });

  it("keeps the assignee OR out of `where.OR`, which the q search owns", () => {
    const where = buildLeadWhere({ assignee: ["unassigned", "u1"], q: "priya" });
    expect(Array.isArray(where.OR)).toBe(true);
    // q's OR must survive intact — the two filters intersect, not union.
    expect((where.OR as unknown[]).length).toBeGreaterThan(1);
    expect(where.AND).toEqual([
      { OR: [{ assignedToId: null }, { assignedToId: "u1" }] },
    ]);
  });
});

describe("resolveAssigneeFilter — multi", () => {
  it("passes several picks straight through", () => {
    expect(resolveAssigneeFilter(["u1", "u2"], { isBde: true, userId: "u9" })).toEqual(["u1", "u2"]);
  });

  it("returns a lone pick as a bare string", () => {
    expect(resolveAssigneeFilter(["u1"], { isBde: true, userId: "u9" })).toBe("u1");
  });

  it("still defaults a BDE with no pick to their own queue", () => {
    expect(resolveAssigneeFilter([], { isBde: true, userId: "u9" })).toBe("u9");
  });
});

describe("buildCrmTaskWhere — multi-select filters", () => {
  const now = new Date("2026-09-03T10:00:00");

  it("keeps the status filter for one pick and drops it when both are picked", () => {
    expect(buildCrmTaskWhere({ status: ["open"] }).status).toBe("open");
    // open + done narrows nothing, so no status restriction is emitted.
    expect(buildCrmTaskWhere({ status: ["open", "done"] }).status).toBeUndefined();
  });

  it("turns several priorities into an IN", () => {
    expect(buildCrmTaskWhere({ priority: ["high", "low"] }).priority).toEqual({ in: ["high", "low"] });
    expect(buildCrmTaskWhere({ priority: ["bogus"] }).priority).toBeUndefined();
  });

  it("unions due buckets rather than narrowing them", () => {
    const where = buildCrmTaskWhere({ due: ["overdue", "no_date"], now });
    const and = where.AND as Array<{ OR: Array<Record<string, unknown>> }>;
    expect(and).toHaveLength(1);
    expect(and[0].OR).toHaveLength(2);
    expect(and[0].OR[1]).toEqual({ dueAt: null });
  });

  it("scopes 'overdue' to open tasks inside its own branch, not by overwriting status", () => {
    const where = buildCrmTaskWhere({ status: ["done"], due: ["overdue"], now });
    expect(where.status).toBe("done"); // the user's status pick survives
    const and = where.AND as Array<{ OR: Array<Record<string, unknown>> }>;
    expect(and[0].OR[0]).toMatchObject({ status: "open" });
  });

  it("ORs unassigned together with picked consultants", () => {
    const where = buildCrmTaskWhere({ assignee: ["unassigned", "u1"] });
    expect(where.assignedToId).toBeUndefined();
    expect(where.AND).toEqual([{ OR: [{ assignedToId: null }, { assignedToId: "u1" }] }]);
  });
});

describe("dueDateRange — the tasks board's due-date range", () => {
  it("makes the picked end day inclusive by resolving it to the next midnight", () => {
    const r = dueDateRange("2026-07-01", "2026-07-31");
    expect(r.from).toEqual(new Date(2026, 6, 1));
    expect(r.to).toEqual(new Date(2026, 7, 1)); // exclusive: 31 Jul is still in
  });

  it("applies each end on its own", () => {
    expect(dueDateRange("2026-07-01", undefined)).toEqual({ from: new Date(2026, 6, 1), to: undefined });
    expect(dueDateRange(undefined, "2026-07-31")).toEqual({ from: undefined, to: new Date(2026, 7, 1) });
  });

  it("ignores a blank, malformed or inverted range rather than matching nothing", () => {
    expect(dueDateRange(undefined, undefined)).toEqual({ from: undefined, to: undefined });
    expect(dueDateRange("not-a-date", "31-07-2026")).toEqual({ from: undefined, to: undefined });
    expect(dueDateRange("2026-07-31", "2026-07-01")).toEqual({});
  });

  it("rolls a month end over correctly", () => {
    expect(dueDateRange(undefined, "2026-01-31").to).toEqual(new Date(2026, 1, 1));
  });
});

describe("buildCrmTaskWhere — due-date range", () => {
  const now = new Date("2026-09-03T10:00:00");

  it("narrows the picked buckets rather than joining their union", () => {
    const where = buildCrmTaskWhere({
      due: ["overdue"],
      dueFrom: new Date(2026, 6, 1),
      dueTo: new Date(2026, 7, 1),
      now,
    });
    const and = where.AND as Array<Record<string, unknown>>;
    // The bucket OR and the range are separate AND terms — both must hold.
    expect(and).toHaveLength(2);
    expect(and[1]).toEqual({ dueAt: { gte: new Date(2026, 6, 1), lt: new Date(2026, 7, 1) } });
  });

  it("applies an open-ended range on its own", () => {
    expect(buildCrmTaskWhere({ dueFrom: new Date(2026, 6, 1) }).AND).toEqual([
      { dueAt: { gte: new Date(2026, 6, 1) } },
    ]);
    expect(buildCrmTaskWhere({ dueTo: new Date(2026, 7, 1) }).AND).toEqual([
      { dueAt: { lt: new Date(2026, 7, 1) } },
    ]);
  });

  it("emits nothing when no range is given", () => {
    expect(buildCrmTaskWhere({ now }).AND).toBeUndefined();
  });
});

describe("crmTaskFilterParamsFromQuery — due-date range", () => {
  const opts = { isBde: false, userId: "u1" };

  it("reads dueFrom/dueTo off the query string, end day inclusive", () => {
    const sp = new URLSearchParams("due=overdue&dueFrom=2026-07-01&dueTo=2026-07-31");
    const p = crmTaskFilterParamsFromQuery(sp, opts);
    expect(p.due).toEqual(["overdue"]);
    expect(p.dueFrom).toEqual(new Date(2026, 6, 1));
    expect(p.dueTo).toEqual(new Date(2026, 7, 1));
  });

  it("leaves the range undefined when the params are absent", () => {
    const p = crmTaskFilterParamsFromQuery(new URLSearchParams(""), opts);
    expect(p.dueFrom).toBeUndefined();
    expect(p.dueTo).toBeUndefined();
  });
});

describe("crmTaskAssigneeScope", () => {
  it("is global for an empty pick or the 'all' opt-out", () => {
    expect(crmTaskAssigneeScope([])).toEqual({});
    expect(crmTaskAssigneeScope(["u1", "all"])).toEqual({});
  });

  it("is global for an unassigned-only pick — that pile has no owner to scope to", () => {
    expect(crmTaskAssigneeScope(["unassigned"])).toEqual({});
  });

  it("narrows to the picked consultants", () => {
    expect(crmTaskAssigneeScope(["u1"])).toEqual({ assignedToId: "u1" });
    expect(crmTaskAssigneeScope(["u1", "u2"])).toEqual({ assignedToId: { in: ["u1", "u2"] } });
  });
});

describe("bulkStageSkipReason — what a bulk stage change may move", () => {
  const lead = (statusId: string, code: string) => ({ statusId, status: { code } });

  it("moves a lead sitting on a different stage", () => {
    expect(bulkStageSkipReason(lead("s1", "follow_up"), "s2")).toBeNull();
  });

  it("skips a lead already on the target stage", () => {
    expect(bulkStageSkipReason(lead("s2", "follow_up"), "s2")).toBe("unchanged");
  });

  it("never moves an Enrolled lead — its finance/Ops records own that stage", () => {
    expect(bulkStageSkipReason(lead("s9", "enrolled"), "s2")).toBe("enrolled");
  });

  it("reports Enrolled ahead of unchanged, so the reason is the blocking one", () => {
    // An enrolled lead targeted AT the enrolled stage is blocked either way;
    // saying "already there" would wrongly imply the picker could move it.
    expect(bulkStageSkipReason(lead("s9", "enrolled"), "s9")).toBe("enrolled");
  });

  it("leaves the other action-only stages movable, matching the PATCH route", () => {
    // `pipeline` (Set deal) and `duplicate` (importer flag) are only blocked as
    // a TARGET (isActionOnlyStatus); a lead may legitimately be moved OFF them.
    expect(bulkStageSkipReason(lead("s3", "pipeline"), "s2")).toBeNull();
    expect(bulkStageSkipReason(lead("s4", "duplicate"), "s2")).toBeNull();
    expect(isActionOnlyStatus("pipeline")).toBe(true);
    expect(isActionOnlyStatus("duplicate")).toBe(true);
    expect(isActionOnlyStatus("enrolled")).toBe(true);
    expect(isActionOnlyStatus("follow_up")).toBe(false);
  });
});
