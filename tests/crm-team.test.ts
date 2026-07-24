import { describe, it, expect, vi } from "vitest";

// crm-team (and its transitive imports) construct the prisma client at module
// load. The functions under test are pure, so mock prisma to avoid a real DB.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  SLA_THRESHOLD_DAYS,
  ABANDONED_DAYS,
  STUCK_DAYS,
  FIRST_RESPONSE_SLA_HOURS,
  touchActivityWhere,
  outboundContactWhere,
  ageInDays,
  classifyStaleness,
  attentionFlags,
  startOfLocalDay,
  startOfNextLocalDay,
  hasUpcomingTask,
  isTaskOnTime,
  isDeliberateAssignment,
  IMPORT_CARRYOVER_GRACE_MS,
  resolveTeamScope,
  median,
  firstContactAfterAssignment,
  computeFirstResponseStats,
  bucketByLocalDay,
} from "@/lib/crm-team";

const DAY = 86_400_000;

describe("touchActivityWhere", () => {
  it("excludes the passive LEAD_OPENED view", () => {
    expect(touchActivityWhere().type).toEqual({ notIn: ["LEAD_OPENED"] });
  });

  it("excludes bulk-email sends (EMAIL_SENT with metadata.bulk = true)", () => {
    expect(touchActivityWhere().NOT).toEqual({
      type: "EMAIL_SENT",
      metadata: { path: ["bulk"], equals: true },
    });
  });
});

describe("outboundContactWhere", () => {
  it("matches only call/email/whatsapp and still excludes bulk email", () => {
    const where = outboundContactWhere();
    expect(where.type).toEqual({ in: ["CALL_LOGGED", "EMAIL_SENT", "WHATSAPP_SENT"] });
    expect(where.NOT).toEqual({ type: "EMAIL_SENT", metadata: { path: ["bulk"], equals: true } });
  });
});

describe("ageInDays", () => {
  it("returns whole days between two instants", () => {
    const now = new Date("2026-06-24T12:00:00Z");
    expect(ageInDays(now, new Date(now.getTime() - 3 * DAY))).toBe(3);
  });
  it("is negative for a future instant", () => {
    const now = new Date("2026-06-24T12:00:00Z");
    expect(ageInDays(now, new Date(now.getTime() + DAY))).toBe(-1);
  });
});

describe("classifyStaleness — per-status SLA", () => {
  const now = new Date("2026-06-24T12:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  it("breaches Not Yet Started after 1 day untouched", () => {
    expect(classifyStaleness({ statusCode: "not_yet_started", lastTouchAt: ago(1.5), now }).breached).toBe(true);
  });

  it("does not breach Not Yet Started at exactly the threshold", () => {
    // age == SLA is not a breach (must be strictly older).
    expect(classifyStaleness({ statusCode: "not_yet_started", lastTouchAt: ago(1), now }).breached).toBe(false);
  });

  it("does not SLA-monitor Re-marketing — a slow-drip nurture bucket has no response deadline", () => {
    // Re-marketing is intentionally absent from SLA_THRESHOLD_DAYS: no breach at any age.
    const long = classifyStaleness({ statusCode: "re_marketing", lastTouchAt: ago(20), now });
    expect(long.slaDays).toBeNull();
    expect(long.breached).toBe(false);
    // ...but a truly-dead re-marketing lead still surfaces via the global abandoned flag.
    expect(classifyStaleness({ statusCode: "re_marketing", lastTouchAt: ago(31), now }).abandoned).toBe(true);
  });

  it("returns slaDays null for a status with no configured SLA", () => {
    const v = classifyStaleness({ statusCode: "enrolled", lastTouchAt: ago(99), now });
    expect(v.slaDays).toBeNull();
    expect(v.breached).toBe(false);
  });

  it("flags abandoned past 30 days regardless of stage", () => {
    expect(classifyStaleness({ statusCode: "follow_up", lastTouchAt: ago(29), now }).abandoned).toBe(false);
    expect(classifyStaleness({ statusCode: "follow_up", lastTouchAt: ago(31), now }).abandoned).toBe(true);
  });

  it("keeps the documented policy constants", () => {
    expect(SLA_THRESHOLD_DAYS).toMatchObject({
      not_yet_started: 1,
      qualify: 3,
      follow_up: 2,
      pipeline: 3,
    });
    // Re-marketing is deliberately NOT SLA-monitored (nurture bucket).
    expect(SLA_THRESHOLD_DAYS.re_marketing).toBeUndefined();
    expect(ABANDONED_DAYS).toBe(30);
    expect(STUCK_DAYS).toBe(14);
    expect(FIRST_RESPONSE_SLA_HOURS).toBe(24);
  });
});

describe("attentionFlags — combined bucket classification", () => {
  const now = new Date("2026-06-24T12:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const fresh = { statusCode: "qualify", lastTouchAt: ago(1), stuckSince: ago(1), hasOpenTask: true, nextTaskDueAt: null, now };

  it("is not flagged when fresh, has an open task, and sits in-stage briefly", () => {
    const f = attentionFlags(fresh);
    expect(f).toMatchObject({ slaBreached: false, abandoned: false, noNextStep: false, stuck: false, flagged: false });
  });

  it("flags an SLA breach past the stage threshold", () => {
    const f = attentionFlags({ ...fresh, lastTouchAt: ago(5) }); // qualify SLA = 3d
    expect(f.slaBreached).toBe(true);
    expect(f.slaDays).toBe(3);
    expect(f.flagged).toBe(true);
  });

  it("flags no-next-step when there is no open task", () => {
    const f = attentionFlags({ ...fresh, hasOpenTask: false });
    expect(f.noNextStep).toBe(true);
    expect(f.flagged).toBe(true);
  });

  it("flags stuck strictly past STUCK_DAYS in stage, using stuckSince not lastTouch", () => {
    expect(attentionFlags({ ...fresh, stuckSince: ago(STUCK_DAYS) }).stuck).toBe(false);
    const f = attentionFlags({ ...fresh, stuckSince: ago(STUCK_DAYS + 1) });
    expect(f.stuck).toBe(true);
    expect(f.daysInStage).toBeGreaterThan(STUCK_DAYS);
    expect(f.flagged).toBe(true);
  });

  it("flags abandoned past ABANDONED_DAYS regardless of stage", () => {
    const f = attentionFlags({ ...fresh, lastTouchAt: ago(ABANDONED_DAYS + 1) });
    expect(f.abandoned).toBe(true);
    expect(f.flagged).toBe(true);
  });

  it("reports every bucket a lead hits at once", () => {
    const f = attentionFlags({ statusCode: "follow_up", lastTouchAt: ago(40), stuckSince: ago(40), hasOpenTask: false, nextTaskDueAt: null, now });
    expect(f).toMatchObject({ slaBreached: true, abandoned: true, noNextStep: true, stuck: true, flagged: true });
  });

  it("suppresses SLA breach and stuck when an upcoming task is scheduled", () => {
    // Would breach (qualify SLA = 3d, idle 5d) AND be stuck (in stage 20d), but a
    // task is due tomorrow — the consultant has a planned next step.
    const f = attentionFlags({
      ...fresh,
      lastTouchAt: ago(5),
      stuckSince: ago(20),
      nextTaskDueAt: new Date(now.getTime() + DAY),
    });
    expect(f).toMatchObject({ slaBreached: false, stuck: false, flagged: false });
  });

  it("still counts abandoned even with an upcoming task (carve-out is SLA/stuck only)", () => {
    const f = attentionFlags({
      ...fresh,
      lastTouchAt: ago(ABANDONED_DAYS + 1),
      nextTaskDueAt: new Date(now.getTime() + 7 * DAY),
    });
    expect(f).toMatchObject({ abandoned: true, slaBreached: false, flagged: true });
  });

  it("does not suppress when the earliest open task is already overdue", () => {
    // A lapsed (overdue) task is not a live next step — the lead still breaches.
    const f = attentionFlags({
      ...fresh,
      lastTouchAt: ago(5),
      stuckSince: ago(20),
      nextTaskDueAt: ago(2), // due 2 days ago
    });
    expect(f).toMatchObject({ slaBreached: true, stuck: true, flagged: true });
  });

  it("treats a task due today (day not yet passed) as upcoming", () => {
    const f = attentionFlags({
      ...fresh,
      lastTouchAt: ago(5),
      nextTaskDueAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8), // earlier today
    });
    expect(f.slaBreached).toBe(false);
  });
});

describe("hasUpcomingTask", () => {
  const now = new Date(2026, 5, 24, 12, 0); // local noon

  it("is false when there is no scheduled task", () => {
    expect(hasUpcomingTask(null, now)).toBe(false);
  });
  it("counts a task due today as upcoming (its day has not passed)", () => {
    expect(hasUpcomingTask(new Date(2026, 5, 24, 8, 0), now)).toBe(true);
  });
  it("counts a task due tomorrow as upcoming", () => {
    expect(hasUpcomingTask(new Date(2026, 5, 25, 9, 0), now)).toBe(true);
  });
  it("is false for an overdue task (due before today)", () => {
    expect(hasUpcomingTask(new Date(2026, 5, 23, 23, 0), now)).toBe(false);
  });
});

describe("local day helpers", () => {
  it("startOfLocalDay zeroes the time", () => {
    const d = startOfLocalDay(new Date(2026, 5, 24, 15, 30));
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(24);
  });
  it("startOfNextLocalDay advances one calendar day", () => {
    expect(startOfNextLocalDay(new Date(2026, 5, 24, 15, 30)).getDate()).toBe(25);
  });
});

describe("isTaskOnTime", () => {
  it("counts a task finished before its due day as on time", () => {
    expect(isTaskOnTime({ completedAt: new Date(2026, 5, 9, 10), dueAt: new Date(2026, 5, 10) })).toBe(true);
  });
  it("counts a task finished on its due day as on time", () => {
    expect(isTaskOnTime({ completedAt: new Date(2026, 5, 10, 23), dueAt: new Date(2026, 5, 10) })).toBe(true);
  });
  it("counts a task finished after its due day as late", () => {
    expect(isTaskOnTime({ completedAt: new Date(2026, 5, 12, 1), dueAt: new Date(2026, 5, 10) })).toBe(false);
  });
  it("treats a task with no due date as on time", () => {
    expect(isTaskOnTime({ completedAt: new Date(2026, 5, 12), dueAt: null })).toBe(true);
  });
  it("never counts an uncompleted task as on time", () => {
    expect(isTaskOnTime({ completedAt: null, dueAt: new Date(2026, 5, 10) })).toBe(false);
  });
});

describe("isDeliberateAssignment", () => {
  const importedAt = new Date("2026-06-01T00:00:00Z");

  it("rejects unassigned leads", () => {
    expect(isDeliberateAssignment({ assignedToId: null, assignedAt: new Date(), importBatchCreatedAt: null })).toBe(false);
  });

  it("rejects leads with no assignedAt", () => {
    expect(isDeliberateAssignment({ assignedToId: "u1", assignedAt: null, importBatchCreatedAt: null })).toBe(false);
  });

  it("accepts a manually-created lead (no import batch)", () => {
    expect(isDeliberateAssignment({ assignedToId: "u1", assignedAt: new Date(), importBatchCreatedAt: null })).toBe(true);
  });

  it("rejects bulk-import carryover (assigned at import time)", () => {
    const assignedAt = new Date(importedAt.getTime() + IMPORT_CARRYOVER_GRACE_MS - 1);
    expect(isDeliberateAssignment({ assignedToId: "u1", assignedAt, importBatchCreatedAt: importedAt })).toBe(false);
  });

  it("accepts an imported lead reassigned meaningfully later", () => {
    const assignedAt = new Date(importedAt.getTime() + IMPORT_CARRYOVER_GRACE_MS + 60_000);
    expect(isDeliberateAssignment({ assignedToId: "u1", assignedAt, importBatchCreatedAt: importedAt })).toBe(true);
  });
});

describe("resolveTeamScope", () => {
  const base = { isAdmin: false, isSupervisor: false, canManageCrm: false, userId: "u1" };

  it("lets a system admin see the whole team by default", () => {
    expect(resolveTeamScope({ ...base, isAdmin: true })).toEqual({
      restrictToUserId: null,
      teamWide: true,
      canViewWholeTeam: true,
      selfUserId: "u1",
    });
  });

  it("lets a supervisor and the CRM-admin tier see the whole team", () => {
    expect(resolveTeamScope({ ...base, isSupervisor: true }).teamWide).toBe(true);
    expect(resolveTeamScope({ ...base, canManageCrm: true }).teamWide).toBe(true);
  });

  it("locks a plain BDE to their own numbers with no toggle", () => {
    expect(resolveTeamScope(base)).toEqual({
      restrictToUserId: "u1",
      teamWide: false,
      canViewWholeTeam: false,
      selfUserId: "u1",
    });
  });

  it("ignores a 'me' request from a plain BDE (they are already self)", () => {
    const s = resolveTeamScope(base, "me");
    expect(s.restrictToUserId).toBe("u1");
    expect(s.canViewWholeTeam).toBe(false);
  });

  it("lets a team-wide user flip to their own activity with scope=me", () => {
    expect(resolveTeamScope({ ...base, canManageCrm: true }, "me")).toEqual({
      restrictToUserId: "u1",
      teamWide: false,
      canViewWholeTeam: true,
      selfUserId: "u1",
    });
  });

  it("keeps a team-wide user on the team view for any non-'me' request", () => {
    expect(resolveTeamScope({ ...base, isAdmin: true }, "team").teamWide).toBe(true);
    expect(resolveTeamScope({ ...base, isAdmin: true }).teamWide).toBe(true);
  });

  it("lets a view-only team lead see the whole team with the toggle", () => {
    const s = resolveTeamScope({ ...base, isCrmTeamLead: true });
    expect(s.teamWide).toBe(true);
    expect(s.canViewWholeTeam).toBe(true);
  });

  it("lets a team lead flip to just their own activity", () => {
    expect(resolveTeamScope({ ...base, isCrmTeamLead: true }, "me")).toEqual({
      restrictToUserId: "u1",
      teamWide: false,
      canViewWholeTeam: true,
      selfUserId: "u1",
    });
  });
});

describe("median", () => {
  it("returns null for an empty list", () => {
    expect(median([])).toBeNull();
  });
  it("returns the middle value for odd counts", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("averages the two middle values for even counts", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("firstContactAfterAssignment", () => {
  const t = (iso: string) => new Date(iso);

  it("picks the earliest contact at or after assignment", () => {
    const assignments = [{ leadId: "l1", assignedAt: t("2026-06-20T09:00:00Z") }];
    const contacts = [
      { leadId: "l1", occurredAt: t("2026-06-21T09:00:00Z") },
      { leadId: "l1", occurredAt: t("2026-06-20T15:00:00Z") },
    ];
    expect(firstContactAfterAssignment(assignments, contacts).get("l1")).toEqual(t("2026-06-20T15:00:00Z"));
  });

  it("ignores contacts logged before assignment", () => {
    const assignments = [{ leadId: "l1", assignedAt: t("2026-06-20T09:00:00Z") }];
    const contacts = [{ leadId: "l1", occurredAt: t("2026-06-19T09:00:00Z") }];
    expect(firstContactAfterAssignment(assignments, contacts).has("l1")).toBe(false);
  });

  it("ignores contacts for leads not in the assignment set", () => {
    const out = firstContactAfterAssignment([], [{ leadId: "x", occurredAt: t("2026-06-20T09:00:00Z") }]);
    expect(out.size).toBe(0);
  });
});

describe("computeFirstResponseStats", () => {
  const now = new Date("2026-06-24T12:00:00Z");

  it("counts a lead never contacted as pending, and a breach once past the SLA", () => {
    const assignments = [{ leadId: "l1", assignedAt: new Date(now.getTime() - 2 * DAY) }];
    const stats = computeFirstResponseStats({ assignments, firstContactByLead: new Map(), now });
    expect(stats).toMatchObject({ pending: 1, breached: 1, medianHours: null });
  });

  it("does not breach a freshly-assigned lead still within the SLA window", () => {
    const assignments = [{ leadId: "l1", assignedAt: new Date(now.getTime() - 2 * 3_600_000) }];
    const stats = computeFirstResponseStats({ assignments, firstContactByLead: new Map(), now });
    expect(stats).toMatchObject({ pending: 1, breached: 0 });
  });

  it("measures response hours and flags late responses", () => {
    const a1 = new Date("2026-06-20T00:00:00Z");
    const a2 = new Date("2026-06-21T00:00:00Z");
    const assignments = [
      { leadId: "fast", assignedAt: a1 },
      { leadId: "slow", assignedAt: a2 },
    ];
    const firstContactByLead = new Map([
      ["fast", new Date(a1.getTime() + 2 * 3_600_000)], // 2h → on time
      ["slow", new Date(a2.getTime() + 30 * 3_600_000)], // 30h → breach
    ]);
    const stats = computeFirstResponseStats({ assignments, firstContactByLead, now });
    expect(stats.pending).toBe(0);
    expect(stats.breached).toBe(1);
    expect(stats.medianHours).toBe((2 + 30) / 2);
  });
});

describe("bucketByLocalDay", () => {
  it("buckets rows into the last N local days with today last", () => {
    const now = new Date(2026, 5, 24, 12, 0);
    const rows = [
      { at: new Date(2026, 5, 24, 9) }, // today
      { at: new Date(2026, 5, 24, 18) }, // today
      { at: new Date(2026, 5, 23, 10) }, // yesterday
      { at: new Date(2026, 5, 18, 10) }, // 6 days ago
    ];
    const series = bucketByLocalDay(rows, now, 7);
    expect(series).toHaveLength(7);
    expect(series[6]).toBe(2); // today
    expect(series[5]).toBe(1); // yesterday
    expect(series[0]).toBe(1); // 6 days ago
  });

  it("drops rows outside the window", () => {
    const now = new Date(2026, 5, 24, 12, 0);
    const series = bucketByLocalDay([{ at: new Date(2026, 5, 1) }], now, 7);
    expect(series.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
