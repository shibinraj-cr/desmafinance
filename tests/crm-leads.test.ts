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
  isCentralisedStatus,
  leadFilterParamsFromQuery,
  LEAD_IDLE_BUCKETS,
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

  it("exempts ANY parked stage — a centralised-marketing lead needs no manual follow-up", () => {
    expect(
      requiresNextStepOnComplete({
        completing: true,
        leadKind: "active",
        remainingOpenTasks: 0,
        statusCode: "centralised_marketing",
        parked: true,
      }),
    ).toBe(false);
  });

  it("lets the parked flag win over the legacy code carve-out in both directions", () => {
    // An un-parked Re-marketing stage goes back to needing a next step…
    expect(
      requiresNextStepOnComplete({
        completing: true,
        leadKind: "active",
        remainingOpenTasks: 0,
        statusCode: "re_marketing",
        parked: false,
      }),
    ).toBe(true);
    // …and an unknown stage that is parked is exempt.
    expect(
      requiresNextStepOnComplete({
        completing: true,
        leadKind: "active",
        remainingOpenTasks: 0,
        statusCode: "some_new_stage",
        parked: true,
      }),
    ).toBe(false);
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

describe("buildLeadWhere — status (the cross-stage state)", () => {
  it("filters on the status alone, independent of stage", () => {
    // The whole point: picking a status must NOT constrain statusId, so
    // "Details Sent and Not Responding" is returned from every stage at once.
    const w = buildLeadWhere({ substatus: "lss_details_no_response" });
    expect(w.subStatusId).toBe("lss_details_no_response");
    expect(w.statusId).toBeUndefined();
  });

  it("takes several statuses as an IN", () => {
    // e.g. every "Not Responding" variant at once — the chase list.
    const w = buildLeadWhere({ substatus: ["lss_details_no_response", "lss_docs_no_response"] });
    expect(w.subStatusId).toEqual({ in: ["lss_details_no_response", "lss_docs_no_response"] });
  });

  it("composes with a stage filter rather than replacing it", () => {
    const w = buildLeadWhere({ status: "follow_up", substatus: "lss_details_awaiting" });
    expect(w.statusId).toBe("follow_up");
    expect(w.subStatusId).toBe("lss_details_awaiting");
  });

  it("applies no status filter when none is picked", () => {
    expect(buildLeadWhere({}).subStatusId).toBeUndefined();
  });

  it("does not filter on how long the lead has been in its status", () => {
    // Ageing is display-and-sort only. Whether a candidate is responding is
    // said by the status label itself, so there is no silence clause to add.
    const w = buildLeadWhere({ substatus: "lss_details_no_response" });
    expect(w.subStatusSince).toBeUndefined();
  });
});

describe("leadFilterParamsFromQuery — status params", () => {
  const opts = { isBde: false, userId: "u1" };

  it("reads repeated statuses", () => {
    const p = leadFilterParamsFromQuery(new URLSearchParams("substatus=a&substatus=b"), opts);
    expect(p.substatus).toEqual(["a", "b"]);
  });

  it("does not confuse the stage param with the status param", () => {
    // `?status=` is the STAGE and predates this field — saved bookmarks that
    // carry it must keep meaning what they always meant.
    const p = leadFilterParamsFromQuery(new URLSearchParams("status=follow_up&substatus=x"), opts);
    expect(p.status).toEqual(["follow_up"]);
    expect(p.substatus).toEqual(["x"]);
  });
});

describe("buildLeadWhere — open-task filter (the chase list)", () => {
  it("finds leads with nothing scheduled to move them forward", () => {
    const w = buildLeadWhere({ task: "none" });
    expect(w.AND).toEqual([{ tasks: { none: { status: "open" } } }]);
  });

  it("finds leads that do have an open task", () => {
    const w = buildLeadWhere({ task: "open" });
    expect(w.AND).toEqual([{ tasks: { some: { status: "open" } } }]);
  });

  it("applies no task filter when neither option is picked", () => {
    expect(buildLeadWhere({}).AND).toBeUndefined();
  });

  it("treats picking both options as picking neither", () => {
    // "No open task OR has an open task" is every lead — a filter that narrows
    // nothing should cost nothing, not emit a contradictory clause.
    expect(buildLeadWhere({ task: ["none", "open"] }).AND).toBeUndefined();
  });

  it("ignores a stray value rather than matching everything", () => {
    expect(buildLeadWhere({ task: "overdue" }).AND).toBeUndefined();
  });

  it("intersects with the consultant filter rather than widening it", () => {
    // The whole point of the pairing: "Priya's leads with no open task".
    const w = buildLeadWhere({ assignee: "u1", task: "none" });
    expect(w.assignedToId).toBe("u1");
    expect(w.AND).toEqual([{ tasks: { none: { status: "open" } } }]);
  });

  it("keeps the free-text search in OR and the task clause in AND", () => {
    // `q` owns where.OR; a task clause landing there would union the two and
    // return every lead with no open task regardless of the search.
    const w = buildLeadWhere({ q: "priya", task: "none" });
    expect(Array.isArray(w.OR)).toBe(true);
    expect(w.AND).toEqual([{ tasks: { none: { status: "open" } } }]);
  });
});

describe("buildLeadWhere — idle buckets (no updates for N days)", () => {
  const now = new Date("2026-09-23T10:00:00.000Z");
  const daysBefore = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it("bounds a closed bucket on both sides", () => {
    // 1–10 days idle: last touched at least 1 day ago, less than 11 days ago.
    const w = buildLeadWhere({ idle: "1_10", now });
    expect(w.AND).toEqual([
      { OR: [{ lastActivityAt: { lte: daysBefore(1), gt: daysBefore(11) } }] },
    ]);
  });

  it("leaves the top bucket open-ended", () => {
    const w = buildLeadWhere({ idle: "40_plus", now });
    expect(w.AND).toEqual([{ OR: [{ lastActivityAt: { lte: daysBefore(41) } }] }]);
  });

  it("unions several buckets as an OR", () => {
    const w = buildLeadWhere({ idle: ["21_30", "40_plus"], now });
    expect(w.AND).toEqual([
      {
        OR: [
          { lastActivityAt: { lte: daysBefore(21), gt: daysBefore(31) } },
          { lastActivityAt: { lte: daysBefore(41) } },
        ],
      },
    ]);
  });

  it("partitions the timeline — the buckets are contiguous and never overlap", () => {
    // Each bucket starts exactly where the one below it ends, so a lead of any
    // age falls in exactly one. Guards a future edit that renumbers a band.
    const closed = LEAD_IDLE_BUCKETS.filter((b) => b.maxDays !== null);
    for (const b of closed) expect(b.maxDays!).toBeGreaterThanOrEqual(b.minDays);
    for (let i = 1; i < LEAD_IDLE_BUCKETS.length; i++) {
      expect(LEAD_IDLE_BUCKETS[i].minDays).toBe(LEAD_IDLE_BUCKETS[i - 1].maxDays! + 1);
    }
  });

  it("does not reach a lead touched today", () => {
    // The lowest bucket starts at 1 day, so a freshly-worked lead matches none
    // of them — "idle" has to mean idle.
    expect(LEAD_IDLE_BUCKETS[0].minDays).toBe(1);
  });

  it("ignores an unknown bucket rather than matching every lead", () => {
    expect(buildLeadWhere({ idle: "99_plus", now }).AND).toBeUndefined();
  });

  it("intersects with the consultant and task filters", () => {
    const w = buildLeadWhere({ assignee: "u1", task: "none", idle: "11_20", now });
    expect(w.assignedToId).toBe("u1");
    expect(w.AND).toEqual([
      { tasks: { none: { status: "open" } } },
      { OR: [{ lastActivityAt: { lte: daysBefore(11), gt: daysBefore(21) } }] },
    ]);
  });
});

describe("leadFilterParamsFromQuery — task and idle params", () => {
  const opts = { isBde: false, userId: "u1" };

  it("reads the task filter", () => {
    expect(leadFilterParamsFromQuery(new URLSearchParams("task=none"), opts).task).toEqual(["none"]);
  });

  it("reads repeated idle buckets", () => {
    const p = leadFilterParamsFromQuery(new URLSearchParams("idle=1_10&idle=40_plus"), opts);
    expect(p.idle).toEqual(["1_10", "40_plus"]);
  });

  it("leaves both absent when the query carries neither", () => {
    const p = leadFilterParamsFromQuery(new URLSearchParams("status=follow_up"), opts);
    expect(p.task).toEqual([]);
    expect(p.idle).toEqual([]);
  });
});

describe("isCentralisedStatus — the stage that releases the lead's consultant", () => {
  it("matches the seeded code", () => {
    expect(isCentralisedStatus({ code: "centralised_marketing", label: "Centralised Marketing" })).toBe(true);
  });

  it("matches the American and short spellings the migration also looked for", () => {
    expect(isCentralisedStatus({ code: "centralized_marketing" })).toBe(true);
    expect(isCentralisedStatus({ code: "central_marketing" })).toBe(true);
  });

  it("matches a hand-made stage by label, whatever code the admin gave it", () => {
    // The same `lower(label) LIKE '%central%market%'` test the parked migration
    // used to find (or avoid duplicating) the stage.
    expect(isCentralisedStatus({ code: "cm2", label: "Centralised Re-marketing" })).toBe(true);
    expect(isCentralisedStatus({ code: "pool", label: "central marketing pool" })).toBe(true);
  });

  it("does not match Re-marketing — a re-marketing lead keeps its consultant", () => {
    // Both stages are parked, but only the central pool is ownerless. The drip
    // still belongs to the BDE who put the lead there.
    expect(isCentralisedStatus({ code: "re_marketing", label: "Re-marketing" })).toBe(false);
  });

  it("does not match the ordinary working stages", () => {
    expect(isCentralisedStatus({ code: "follow_up", label: "Follow-Up" })).toBe(false);
    expect(isCentralisedStatus({ code: "not_yet_started", label: "Not Yet Started" })).toBe(false);
    expect(isCentralisedStatus({ code: "enrolled", label: "Enrolled" })).toBe(false);
  });

  it("tolerates a missing label", () => {
    expect(isCentralisedStatus({ code: "follow_up" })).toBe(false);
  });
});
