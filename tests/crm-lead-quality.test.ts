import { describe, expect, it } from "vitest";
import {
  QUALITY_REMIND_EVERY_MINUTES,
  daysUntilQualityDue,
  isQualityOverdue,
  normalizeQuality,
  qualityBucket,
  qualityGate,
  qualityNeedsReason,
  qualityPending,
  shouldRemindQuality,
  type QualitySubject,
} from "@/lib/crm-lead-quality";

const NOW = new Date("2026-10-22T10:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

/** An unrated lead owned by "bde1", due yesterday, in Follow-up. */
function lead(p: Partial<QualitySubject> = {}): QualitySubject {
  return { qualityRating: null, qualityDueAt: ago(1), assignedToId: "bde1", statusCode: "follow_up", ...p };
}

describe("normalizeQuality / qualityNeedsReason", () => {
  it("accepts the four ratings, case-insensitively, and nothing else", () => {
    expect(normalizeQuality("Good")).toBe("good");
    expect(normalizeQuality(" junk ")).toBe("junk");
    expect(normalizeQuality("hot")).toBeNull();
    expect(normalizeQuality(null)).toBeNull();
  });

  it("asks for a reason on Poor and Junk only", () => {
    expect(qualityNeedsReason("poor")).toBe(true);
    expect(qualityNeedsReason("junk")).toBe(true);
    expect(qualityNeedsReason("good")).toBe(false);
    expect(qualityNeedsReason("average")).toBe(false);
  });
});

describe("qualityPending / isQualityOverdue", () => {
  it("is overdue once the due date has passed on an owned, unrated lead", () => {
    expect(isQualityOverdue(lead(), NOW)).toBe(true);
  });

  it("is overdue at the exact due instant, not a moment later", () => {
    expect(isQualityOverdue(lead({ qualityDueAt: NOW }), NOW)).toBe(true);
    expect(isQualityOverdue(lead({ qualityDueAt: new Date(NOW.getTime() + 1) }), NOW)).toBe(false);
  });

  it("accepts the ISO string a client component receives", () => {
    expect(isQualityOverdue(lead({ qualityDueAt: ago(2).toISOString() }), NOW)).toBe(true);
  });

  it("never applies to a lead with no due date (pre-rule backlog, re-enrollments)", () => {
    expect(qualityPending(lead({ qualityDueAt: null }))).toBe(false);
    expect(isQualityOverdue(lead({ qualityDueAt: null }), NOW)).toBe(false);
  });

  it("never applies to an unassigned lead or a system-flagged duplicate", () => {
    expect(isQualityOverdue(lead({ assignedToId: null }), NOW)).toBe(false);
    expect(isQualityOverdue(lead({ statusCode: "duplicate" }), NOW)).toBe(false);
  });

  it("clears the moment the lead is rated", () => {
    expect(isQualityOverdue(lead({ qualityRating: "average" }), NOW)).toBe(false);
  });
});

describe("qualityGate", () => {
  const lost = { code: "not_interested", kind: "lost" };
  const won = { code: "enrolled", kind: "won" };
  const active = { code: "qualify", kind: "active" };

  it("holds an overdue lead's own BDE on any stage move and on task completion", () => {
    expect(qualityGate(lead(), { actorId: "bde1", now: NOW, nextStage: active })).toBe("overdue");
    expect(qualityGate(lead(), { actorId: "bde1", now: NOW })).toBe("overdue");
  });

  it("never holds anyone else — a supervisor acting on the lead isn't the one who owes the rating", () => {
    expect(qualityGate(lead(), { actorId: "supervisor", now: NOW, nextStage: lost })).toBeNull();
  });

  it("asks for the rating when closing a tracked lead early, won or lost", () => {
    const fresh = lead({ qualityDueAt: new Date(NOW.getTime() + 3 * DAY) });
    expect(qualityGate(fresh, { actorId: "bde1", now: NOW, nextStage: lost })).toBe("closing");
    expect(qualityGate(fresh, { actorId: "bde1", now: NOW, nextStage: won })).toBe("closing");
  });

  it("lets an early lead move between active stages, and complete tasks, without a rating", () => {
    const fresh = lead({ qualityDueAt: new Date(NOW.getTime() + 3 * DAY) });
    expect(qualityGate(fresh, { actorId: "bde1", now: NOW, nextStage: active })).toBeNull();
    expect(qualityGate(fresh, { actorId: "bde1", now: NOW })).toBeNull();
  });

  it("never asks when the move is to Duplicate", () => {
    const fresh = lead({ qualityDueAt: new Date(NOW.getTime() + 3 * DAY) });
    expect(qualityGate(fresh, { actorId: "bde1", now: NOW, nextStage: { code: "duplicate", kind: "lost" } })).toBeNull();
  });

  it("is satisfied by a rating, and never applies to an untracked lead", () => {
    expect(qualityGate(lead({ qualityRating: "junk" }), { actorId: "bde1", now: NOW, nextStage: lost })).toBeNull();
    expect(qualityGate(lead({ qualityDueAt: null }), { actorId: "bde1", now: NOW, nextStage: lost })).toBeNull();
  });
});

describe("qualityBucket", () => {
  it("reports the rating when there is one", () => {
    expect(qualityBucket(lead({ qualityRating: "poor" }), NOW)).toBe("poor");
  });

  it("splits the unrated into overdue / not yet due / not required", () => {
    expect(qualityBucket(lead(), NOW)).toBe("overdue");
    expect(qualityBucket(lead({ qualityDueAt: new Date(NOW.getTime() + DAY) }), NOW)).toBe("pending");
    expect(qualityBucket(lead({ qualityDueAt: null }), NOW)).toBe("exempt");
    expect(qualityBucket(lead({ statusCode: "duplicate" }), NOW)).toBe("exempt");
  });
});

describe("daysUntilQualityDue", () => {
  it("counts whole days to the due date, negative once past", () => {
    expect(daysUntilQualityDue(new Date(NOW.getTime() + 2.5 * DAY), NOW)).toBe(2);
    expect(daysUntilQualityDue(ago(1.5), NOW)).toBe(-2);
    expect(daysUntilQualityDue(null, NOW)).toBeNull();
  });
});

describe("shouldRemindQuality", () => {
  const t = NOW.getTime();
  it("opens straight away the first time something is overdue", () => {
    expect(shouldRemindQuality({ now: t, lastShownAt: null, overdueCount: 1 })).toBe(true);
  });
  it("waits out the reminder interval after it was last shown", () => {
    const interval = QUALITY_REMIND_EVERY_MINUTES * 60_000;
    expect(shouldRemindQuality({ now: t, lastShownAt: t - interval + 1, overdueCount: 3 })).toBe(false);
    expect(shouldRemindQuality({ now: t, lastShownAt: t - interval, overdueCount: 3 })).toBe(true);
  });
  it("stays shut when nothing is overdue", () => {
    expect(shouldRemindQuality({ now: t, lastShownAt: null, overdueCount: 0 })).toBe(false);
  });
});
