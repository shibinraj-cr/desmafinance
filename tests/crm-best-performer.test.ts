import { describe, it, expect } from "vitest";

// crm-best-performer and crm-score are pure — their crm-team imports are
// `import type`, so no prisma client is constructed and no module mock is needed.
import { buildBestPerformers, enrollmentScore, conversionScore } from "@/lib/crm-best-performer";
import { buildL2Scorecard } from "@/lib/crm-score";
import { monthLabelFor, singleMonthOf, rangeFor, parsePeriod } from "@/lib/period";
import type { TeamBdeRow } from "@/lib/crm-team";

function row(p: Partial<TeamBdeRow> = {}): TeamBdeRow {
  return {
    userId: "u1",
    displayName: "Member",
    role: "l2",
    assignedPeriod: 200,
    enrolledPeriod: 3,
    conversionPct: 1.5,
    assignedRange: 200,
    calls: 0,
    emails: 0,
    whatsapp: 0,
    contacts: 10,
    tasksCompleted: 10,
    tasksOnTime: 8,
    firstResponseMedianHours: 6,
    firstResponsePending: 0,
    firstResponseBreached: 0,
    activeOwned: 10,
    qualityOverdue: 0,
    slaBreaches: 0,
    abandoned: 0,
    noTask: 0,
    stuck: 0,
    openReinquiry: 0,
    ...p,
  };
}

describe("enrollmentScore", () => {
  it("is the share of target achieved, capped at 100", () => {
    expect(enrollmentScore(6, 8)).toBe(75);
    expect(enrollmentScore(8, 8)).toBe(100);
    expect(enrollmentScore(12, 8)).toBe(100);
    expect(enrollmentScore(0, 8)).toBe(0);
  });

  it("scores 0 when no target is set", () => {
    expect(enrollmentScore(5, 0)).toBe(0);
  });
});

describe("conversionScore", () => {
  it("is 10 × the conversion %", () => {
    expect(conversionScore(1.5)).toBe(15);
    expect(conversionScore(4.2)).toBeCloseTo(42);
  });

  it("caps at 100 (10% conversion or better) and is 0 with nothing assigned", () => {
    expect(conversionScore(10)).toBe(100);
    expect(conversionScore(25)).toBe(100);
    expect(conversionScore(null)).toBe(0);
  });
});

describe("buildBestPerformers", () => {
  it("weights enrollment 50%, scorecard 25%, conversion 25%", () => {
    const rows = [row({ userId: "a", displayName: "A", enrolledPeriod: 6, conversionPct: 1.5 })];
    const card = buildL2Scorecard(rows);
    const [a] = buildBestPerformers(card, rows, new Map([["a", 8]]));
    expect(a.enrollmentScore).toBe(75);
    expect(a.parts.enrollment).toBe(37.5);
    expect(a.parts.scorecard).toBe(Math.round(card[0].score * 2.5) / 10);
    expect(a.parts.conversion).toBe(3.8); // 15 × 25% = 3.75 → 3.8
    expect(a.points).toBe(Math.round((a.parts.enrollment + a.parts.scorecard + a.parts.conversion) * 10) / 10);
  });

  it("ranks by points, breaking ties on enrollments", () => {
    const rows = [
      row({ userId: "low", displayName: "Low", enrolledPeriod: 2, conversionPct: 1 }),
      row({ userId: "high", displayName: "High", enrolledPeriod: 8, conversionPct: 4 }),
    ];
    const ranked = buildBestPerformers(buildL2Scorecard(rows), rows, new Map([["low", 8], ["high", 8]]));
    expect(ranked.map((e) => e.userId)).toEqual(["high", "low"]);
  });

  it("gives an unscored member 0 for the scorecard part, and no target 0 for enrollments", () => {
    const idle = row({
      userId: "idle",
      displayName: "Idle",
      assignedPeriod: 0,
      enrolledPeriod: 0,
      conversionPct: null,
      assignedRange: 0,
      contacts: 0,
      tasksCompleted: 0,
      tasksOnTime: 0,
      activeOwned: 0,
      firstResponseMedianHours: null,
    });
    const [e] = buildBestPerformers(buildL2Scorecard([idle]), [idle], new Map());
    expect(e.scored).toBe(false);
    expect(e.points).toBe(0);
  });

  it("only ranks the scorecard's members (L2, not excluded)", () => {
    const rows = [row({ userId: "l2" }), row({ userId: "l1", role: "l1" }), row({ userId: "mgr" })];
    const ranked = buildBestPerformers(buildL2Scorecard(rows, { excludeUserIds: ["mgr"] }), rows, new Map());
    expect(ranked.map((e) => e.userId)).toEqual(["l2"]);
  });
});

describe("period month helpers", () => {
  it("maps a date to its month preset inside the FY, else null", () => {
    expect(monthLabelFor("2026-10-26")).toBe("Oct-26");
    expect(monthLabelFor("2027-03-01")).toBe("Mar-27");
    expect(monthLabelFor("2027-04-01")).toBeNull();
  });

  it("recognises exactly one calendar month", () => {
    expect(singleMonthOf(rangeFor(parsePeriod({ period: "Sep-26" })))).toEqual({ year: 2026, month: 9 });
    expect(singleMonthOf(rangeFor(parsePeriod({ period: "custom", from: "2026-09-01", to: "2026-09-30" })))).toEqual({
      year: 2026,
      month: 9,
    });
    expect(singleMonthOf(rangeFor(parsePeriod({ period: "custom", from: "2026-09-01", to: "2026-09-15" })))).toBeNull();
    expect(singleMonthOf(rangeFor(parsePeriod({ period: "q2" })))).toBeNull();
    expect(singleMonthOf(rangeFor(parsePeriod({ period: "all" })))).toBeNull();
  });
});
