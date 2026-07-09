import { describe, it, expect } from "vitest";

// crm-score is pure — its only crm-team import is `import type`, erased at build,
// so no prisma client is ever constructed and no module mock is needed.
import {
  scoreL2Member,
  buildL2Scorecard,
  SCORE_WEIGHTS,
  CONVERSION_TARGET_PCT,
} from "@/lib/crm-score";
import type { TeamBdeRow } from "@/lib/crm-team";

/** A full TeamBdeRow with strong-but-plausible defaults; override per test. */
function row(p: Partial<TeamBdeRow> = {}): TeamBdeRow {
  return {
    userId: "u1",
    displayName: "Test Member",
    role: "l2",
    assignedMonth: 10,
    enrolledMonth: 2,
    conversionPct: 20,
    assignedRange: 5,
    calls: 0,
    emails: 0,
    whatsapp: 0,
    contacts: 3,
    tasksCompleted: 10,
    tasksOnTime: 9,
    firstResponseMedianHours: 6,
    firstResponsePending: 0,
    firstResponseBreached: 0,
    activeOwned: 10,
    slaBreaches: 0,
    abandoned: 0,
    noTask: 0,
    stuck: 0,
    openReinquiry: 0,
    ...p,
  };
}

const comp = (s: ReturnType<typeof scoreL2Member>, key: string) =>
  s.components.find((c) => c.key === key)!;

describe("scoreL2Member — component math", () => {
  it("awards full conversion at/above the target, scaling linearly below it", () => {
    expect(comp(scoreL2Member(row({ conversionPct: CONVERSION_TARGET_PCT })), "conversion").earned).toBe(35);
    expect(comp(scoreL2Member(row({ conversionPct: CONVERSION_TARGET_PCT * 2 })), "conversion").earned).toBe(35);
    expect(comp(scoreL2Member(row({ conversionPct: CONVERSION_TARGET_PCT / 2 })), "conversion").earned).toBe(
      Math.round(SCORE_WEIGHTS.conversion / 2),
    );
    expect(comp(scoreL2Member(row({ conversionPct: 0 })), "conversion").earned).toBe(0);
  });

  it("scores responsiveness full when fast, zero at/after the SLA", () => {
    expect(comp(scoreL2Member(row({ firstResponseMedianHours: 6 })), "responsiveness").earned).toBe(20);
    expect(comp(scoreL2Member(row({ firstResponseMedianHours: 2 })), "responsiveness").earned).toBe(20);
    expect(comp(scoreL2Member(row({ firstResponseMedianHours: 24 })), "responsiveness").earned).toBe(0);
    expect(comp(scoreL2Member(row({ firstResponseMedianHours: 48 })), "responsiveness").earned).toBe(0);
    expect(comp(scoreL2Member(row({ firstResponseMedianHours: 15 })), "responsiveness").earned).toBeGreaterThan(0);
  });

  it("scores discipline as the on-time share of completed tasks", () => {
    expect(comp(scoreL2Member(row({ tasksCompleted: 10, tasksOnTime: 10 })), "discipline").earned).toBe(20);
    expect(comp(scoreL2Member(row({ tasksCompleted: 10, tasksOnTime: 5 })), "discipline").earned).toBe(10);
    expect(comp(scoreL2Member(row({ tasksCompleted: 10, tasksOnTime: 0 })), "discipline").earned).toBe(0);
  });

  it("penalises pipeline hygiene by attention flags per active lead", () => {
    expect(comp(scoreL2Member(row({ activeOwned: 10, slaBreaches: 0, abandoned: 0, stuck: 0, noTask: 0 })), "hygiene").earned).toBe(25);
    // 5 flags across 10 leads → rate 0.5 → half marks.
    expect(comp(scoreL2Member(row({ activeOwned: 10, slaBreaches: 5 })), "hygiene").earned).toBe(13);
    // Flags >= active leads → zero.
    expect(comp(scoreL2Member(row({ activeOwned: 10, slaBreaches: 6, abandoned: 4 })), "hygiene").earned).toBe(0);
    // Empty book → nothing to rot → full marks.
    expect(comp(scoreL2Member(row({ activeOwned: 0 })), "hygiene").earned).toBe(25);
  });

  it("falls back to the component midpoint (neutral) when a metric has no data", () => {
    const s = scoreL2Member(row({ conversionPct: null, firstResponseMedianHours: null, tasksCompleted: 0, tasksOnTime: 0 }));
    expect(comp(s, "conversion").neutral).toBe(true);
    expect(comp(s, "responsiveness").neutral).toBe(true);
    expect(comp(s, "discipline").neutral).toBe(true);
    expect(comp(s, "conversion").earned).toBe(Math.round(SCORE_WEIGHTS.conversion / 2));
  });
});

describe("scoreL2Member — total, band, narrative", () => {
  it("sums the displayed components exactly to the total", () => {
    const s = scoreL2Member(row({ conversionPct: 13, firstResponseMedianHours: 11, tasksCompleted: 7, tasksOnTime: 5, activeOwned: 8, stuck: 2 }));
    expect(s.components.reduce((n, c) => n + c.earned, 0)).toBe(s.score);
  });

  it("maps a strong all-round member to Excellent and a weak one to Needs attention", () => {
    const strong = scoreL2Member(row());
    expect(strong.band).toBe("excellent");
    expect(strong.score).toBeGreaterThanOrEqual(80);

    const weak = scoreL2Member(
      row({ conversionPct: 2, firstResponseMedianHours: 30, tasksCompleted: 10, tasksOnTime: 3, activeOwned: 10, slaBreaches: 4, abandoned: 3, stuck: 3 }),
    );
    expect(weak.band).toBe("attention");
    expect(weak.score).toBeLessThan(50);
  });

  it("explains the score with the top strength and the biggest drag", () => {
    const s = scoreL2Member(
      row({ conversionPct: 20, firstResponseMedianHours: 6, tasksCompleted: 10, tasksOnTime: 4, activeOwned: 10 }),
    );
    // Conversion & responsiveness are maxed; task discipline is the weak point.
    expect(s.narrative.toLowerCase()).toContain("but");
    expect(s.narrative.toLowerCase()).toContain("time");
  });

  it("marks a member with no activity as not scored", () => {
    const s = scoreL2Member(
      row({ assignedMonth: 0, assignedRange: 0, contacts: 0, tasksCompleted: 0, tasksOnTime: 0, activeOwned: 0, conversionPct: null, firstResponseMedianHours: null }),
    );
    expect(s.scored).toBe(false);
    expect(s.narrative.toLowerCase()).toContain("no activity");
  });
});

describe("buildL2Scorecard — roster filtering & ranking", () => {
  it("keeps only L2 members, dropping L1s, the excluded ids, and excluded names", () => {
    const rows = [
      row({ userId: "a1", displayName: "Alice", role: "l2" }),
      row({ userId: "b1", displayName: "Bob", role: "l1" }),
      row({ userId: "d1", displayName: "Devika", role: "l2" }),
      row({ userId: "c1", displayName: "Carol", role: "l2" }),
    ];
    const out = buildL2Scorecard(rows, { excludeUserIds: ["c1"] });
    expect(out.map((e) => e.displayName)).toEqual(["Alice"]);
  });

  it("excludes the team-lead name case-insensitively and trimmed", () => {
    const rows = [row({ userId: "d1", displayName: "  DEVIKA " }), row({ userId: "a1", displayName: "Alice" })];
    expect(buildL2Scorecard(rows).map((e) => e.displayName)).toEqual(["Alice"]);
  });

  it("ranks scored members by score (desc), pushing unscored members last", () => {
    const rows = [
      row({ userId: "low", displayName: "Low", conversionPct: 4, firstResponseMedianHours: 20, tasksCompleted: 10, tasksOnTime: 4, activeOwned: 10, slaBreaches: 3 }),
      row({ userId: "idle", displayName: "Idle", assignedMonth: 0, assignedRange: 0, contacts: 0, tasksCompleted: 0, tasksOnTime: 0, activeOwned: 0, conversionPct: null, firstResponseMedianHours: null }),
      row({ userId: "high", displayName: "High" }),
    ];
    const out = buildL2Scorecard(rows);
    expect(out.map((e) => e.userId)).toEqual(["high", "low", "idle"]);
    expect(out[0].score).toBeGreaterThan(out[1].score);
    expect(out[2].scored).toBe(false);
  });
});
