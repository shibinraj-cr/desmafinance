/**
 * Attendance Scorecard math (src/lib/hr-attendance-score.ts).
 *
 * Pure, DB-free scoring: presence (45) + punctuality (30) + full-day (15) +
 * discipline (10). Pins the two product-owner policy calls — LCE never dents
 * punctuality, paid leave never dents presence — plus the band thresholds,
 * the no-data midpoint fallback, and the "rounded parts sum to the total"
 * invariant.
 */
import { describe, it, expect } from "vitest";

import {
  scoreAttendance,
  buildAttendanceScorecard,
  ATT_SCORE_WEIGHTS,
  type AttendanceScoreRow,
} from "@/lib/hr-attendance-score";

/** A fully-present, spotless row unless overridden. */
function row(overrides: Partial<AttendanceScoreRow> = {}): AttendanceScoreRow {
  return {
    employeeId: "e1",
    empCode: "001",
    name: "Test Employee",
    designation: "Consultant",
    daysPresent: 60,
    daysHalfDay: 0,
    daysAbsent: 0,
    daysPaidLeave: 0,
    alDays: 0,
    lceDays: 0,
    earlyOutDays: 0,
    missingPunchDays: 0,
    regRequests: 0,
    cyclesCovered: 3,
    ...overrides,
  };
}

describe("weights", () => {
  it("sum to 100", () => {
    const total =
      ATT_SCORE_WEIGHTS.presence +
      ATT_SCORE_WEIGHTS.punctuality +
      ATT_SCORE_WEIGHTS.completion +
      ATT_SCORE_WEIGHTS.discipline;
    expect(total).toBe(100);
  });
});

describe("scoreAttendance", () => {
  it("perfect attendance scores 100 / excellent", () => {
    const s = scoreAttendance(row());
    expect(s.score).toBe(100);
    expect(s.band).toBe("excellent");
    expect(s.scored).toBe(true);
  });

  it("no attendance data → not scored, all components fall back to midpoint (51)", () => {
    const s = scoreAttendance(
      row({ daysPresent: 0, daysHalfDay: 0, daysAbsent: 0, daysPaidLeave: 0 }),
    );
    expect(s.scored).toBe(false);
    expect(s.components.every((c) => c.neutral)).toBe(true);
    // 23 + 15 + 8 + 5 = 51 (rounded midpoints of 45/30/15/10)
    expect(s.score).toBe(51);
    expect(s.narrative).toMatch(/not scored/i);
  });

  it("fewer than the minimum rostered days → not scored (insufficient), even with real data", () => {
    // 12 present + 2 absent = 14 rostered, below the 20-day gate.
    const s = scoreAttendance(row({ daysPresent: 12, daysAbsent: 2 }));
    expect(s.scored).toBe(false);
    // Components are still computed from real data (not neutral) …
    expect(s.components.find((c) => c.key === "presence")!.neutral).toBe(false);
    // … but the narrative flags the thin sample rather than a real read.
    expect(s.narrative).toMatch(/not enough to score/i);
  });

  it("at the minimum rostered days threshold → scored", () => {
    const s = scoreAttendance(row({ daysPresent: 20, daysAbsent: 0 }));
    expect(s.scored).toBe(true);
  });

  it("the rounded components always sum to the total score", () => {
    const s = scoreAttendance(row({ daysPresent: 54, daysAbsent: 6, alDays: 6, earlyOutDays: 5, missingPunchDays: 3 }));
    const sum = s.components.reduce((acc, c) => acc + c.earned, 0);
    expect(sum).toBe(s.score);
  });

  // ── Policy: LCE never dents punctuality ─────────────────────────────────────
  it("LCE (late within the granted allowance) does not reduce punctuality", () => {
    const s = scoreAttendance(row({ lceDays: 3, alDays: 0 }));
    const punc = s.components.find((c) => c.key === "punctuality")!;
    expect(punc.earned).toBe(ATT_SCORE_WEIGHTS.punctuality); // full 30
  });

  it("AL (late beyond the allowance) reduces punctuality proportionally", () => {
    // AL on 20% of worked days → 1 - 0.2/0.5 = 0.6 → 18/30
    const s = scoreAttendance(row({ daysPresent: 30, alDays: 6 }));
    const punc = s.components.find((c) => c.key === "punctuality")!;
    expect(punc.earned).toBe(18);
  });

  it("AL on half of worked days zeroes punctuality", () => {
    const s = scoreAttendance(row({ daysPresent: 30, alDays: 15 }));
    const punc = s.components.find((c) => c.key === "punctuality")!;
    expect(punc.earned).toBe(0);
  });

  // ── Policy: paid leave never dents presence ─────────────────────────────────
  it("authorised paid leave (LV) is excluded from presence — full marks despite leave", () => {
    const s = scoreAttendance(row({ daysPresent: 50, daysPaidLeave: 10, daysAbsent: 0 }));
    const pres = s.components.find((c) => c.key === "presence")!;
    expect(pres.earned).toBe(ATT_SCORE_WEIGHTS.presence); // full 45, leave ignored
  });

  it("absences drop presence below the 75% floor to zero", () => {
    // 45 present / 60 rostered = 75% → at the zero floor
    const s = scoreAttendance(row({ daysPresent: 45, daysAbsent: 15 }));
    const pres = s.components.find((c) => c.key === "presence")!;
    expect(pres.earned).toBe(0);
  });

  it("half-days count as half a present day for presence", () => {
    // (54 + 0.5*6) / 60 = 0.95 attendance
    const full = scoreAttendance(row({ daysPresent: 54, daysHalfDay: 6, daysAbsent: 0 }));
    const pres = full.components.find((c) => c.key === "presence")!;
    // (0.95 - 0.75) / (0.98 - 0.75) * 45 = 39.1 → 39
    expect(pres.earned).toBe(39);
  });

  it("discipline cap has a floor so a small sample isn't zeroed by one slip", () => {
    // worked = 10 → cap = max(4, 1.5) = 4; 2 incidents → 1 - 2/4 = 0.5 → 5/10
    const s = scoreAttendance(row({ daysPresent: 10, daysAbsent: 0, missingPunchDays: 2 }));
    const disc = s.components.find((c) => c.key === "discipline")!;
    expect(disc.earned).toBe(5);
  });

  it("bands map score → label at the documented thresholds", () => {
    expect(scoreAttendance(row()).band).toBe("excellent"); // 100
    // Nudge into 'attention': heavy absence + lateness + early-outs + punch issues
    const weak = scoreAttendance(
      row({ daysPresent: 40, daysAbsent: 18, daysHalfDay: 2, alDays: 12, earlyOutDays: 10, missingPunchDays: 8 }),
    );
    expect(weak.score).toBeLessThan(50);
    expect(weak.band).toBe("attention");
  });
});

describe("buildAttendanceScorecard", () => {
  it("ranks scored employees by score desc, unscored last", () => {
    const strong = row({ employeeId: "a", name: "Aisha", daysPresent: 60 });
    const weak = row({ employeeId: "b", name: "Bala", daysPresent: 40, daysAbsent: 20, alDays: 10 });
    const empty = row({ employeeId: "c", name: "Chen", daysPresent: 0, daysAbsent: 0, daysPaidLeave: 0 });

    const ranked = buildAttendanceScorecard([weak, empty, strong]);
    expect(ranked.map((r) => r.employeeId)).toEqual(["a", "b", "c"]);
    expect(ranked[2].scored).toBe(false);
  });
});

describe("component calculation breakdown (drill-down popup)", () => {
  it("every component carries a formula, plugged-in steps, and an insight", () => {
    const s = scoreAttendance(row({ daysPresent: 50, daysHalfDay: 4, daysAbsent: 6, alDays: 4, earlyOutDays: 3, missingPunchDays: 2 }));
    for (const c of s.components) {
      expect(c.formula.length).toBeGreaterThan(0);
      expect(c.steps.length).toBeGreaterThan(0);
      expect(c.steps.every((st) => st.label.length > 0 && st.value.length > 0)).toBe(true);
      expect(c.insight.length).toBeGreaterThan(0);
      // The final step should resolve to the earned points.
      expect(c.steps[c.steps.length - 1].label).toMatch(/earned/i);
    }
  });

  it("presence breakdown shows the real attendance-rate arithmetic", () => {
    // 54 present + 6 absent = 60 rostered → 90% attended.
    const pres = scoreAttendance(row({ daysPresent: 54, daysAbsent: 6 })).components.find((c) => c.key === "presence")!;
    expect(pres.steps[0].value).toContain("54");
    expect(pres.steps[0].value).toContain("90%");
    expect(pres.insight).toMatch(/absent/i);
  });

  it("neutral (no-data) component still carries a stub breakdown, not undefined", () => {
    const disc = scoreAttendance(row({ daysPresent: 0, daysAbsent: 0 })).components.find((c) => c.key === "discipline")!;
    expect(disc.neutral).toBe(true);
    expect(disc.formula).toMatch(/no data/i);
    expect(disc.steps.length).toBeGreaterThan(0);
    expect(disc.insight.length).toBeGreaterThan(0);
  });
});
