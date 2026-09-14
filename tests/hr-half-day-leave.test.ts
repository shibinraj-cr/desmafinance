/**
 * Half-day leave: an employee applies for the FIRST or SECOND half of a day
 * rather than the whole one.
 *
 * The behavioural risk isn't the radio button — it's the sandwich rule. It
 * decides whether a week-off next to a leave day flips to loss-of-pay, and for
 * a half-day it only bridges in the direction the ABSENT half touches. Before
 * this change that half could only be guessed from punch deviations; now an
 * approved request states it outright, and the guess must not override the
 * statement.
 */
import { describe, it, expect } from "vitest";
import {
  HALF_SESSIONS,
  isHalfSession,
  halfSessionLabel,
  suggestHalfSession,
} from "@/lib/hr-regularization";
import { inferHdLeaveHalf, computeSandwichFlips, type SandwichDay } from "@/lib/hr-sandwich";

const POLICY = { includeHolidays: true, includeWeekOffs: true, maxGapDays: 7 };

let seq = 0;
function day(
  date: string,
  status: string,
  opts: { late?: number; eo?: number; half?: string | null } = {},
): SandwichDay {
  return {
    id: `d${seq++}`,
    date: new Date(`${date}T00:00:00Z`),
    status,
    lateMinutes: opts.late ?? 0,
    earlyOutMinutes: opts.eo ?? 0,
    halfSession: opts.half ?? null,
  };
}

describe("half-session vocabulary", () => {
  it("offers exactly the two halves, in first-then-second order", () => {
    expect(HALF_SESSIONS.map((h) => h.code)).toEqual(["AM", "PM"]);
  });

  it("accepts only AM/PM as a half", () => {
    expect(isHalfSession("AM")).toBe(true);
    expect(isHalfSession("PM")).toBe(true);
    expect(isHalfSession("first")).toBe(false);
    expect(isHalfSession(null)).toBe(false);
    expect(isHalfSession("")).toBe(false);
  });

  it("labels a half, and calls a full day nothing", () => {
    expect(halfSessionLabel("AM")).toBe("First half");
    expect(halfSessionLabel("PM")).toBe("Second half");
    expect(halfSessionLabel(null)).toBeNull();
    expect(halfSessionLabel(undefined)).toBeNull();
  });
});

describe("suggestHalfSession", () => {
  it("preselects the morning when the employee arrived late", () => {
    expect(suggestHalfSession({ lateMinutes: 240, earlyOutMinutes: 0 })).toBe("AM");
  });

  it("preselects the afternoon when the employee left early", () => {
    expect(suggestHalfSession({ lateMinutes: 0, earlyOutMinutes: 240 })).toBe("PM");
  });

  it("commits to a half even when the punches are ambiguous", () => {
    // Unlike inferHdLeaveHalf (which returns null so the sandwich rule can err
    // toward enforcement), a form radio has to start somewhere.
    expect(suggestHalfSession({ lateMinutes: 0, earlyOutMinutes: 0 })).toBe("AM");
    expect(suggestHalfSession({ lateMinutes: null, earlyOutMinutes: null })).toBe("AM");
    expect(suggestHalfSession({ lateMinutes: 120, earlyOutMinutes: 120 })).toBe("AM");
  });
});

describe("inferHdLeaveHalf with a declared half", () => {
  it("takes the declared half over the punch inference", () => {
    // Punches say the employee came late (morning missing), but the approved
    // request says the SECOND half was the leave. The approval wins.
    expect(inferHdLeaveHalf({ lateMinutes: 240, earlyOutMinutes: 0, halfSession: "PM" })).toBe("PM");
    expect(inferHdLeaveHalf({ lateMinutes: 0, earlyOutMinutes: 240, halfSession: "AM" })).toBe("AM");
  });

  it("resolves an otherwise-ambiguous day when a half is declared", () => {
    expect(inferHdLeaveHalf({ lateMinutes: 0, earlyOutMinutes: 0, halfSession: "PM" })).toBe("PM");
  });

  it("still falls back to the punches when no half was declared", () => {
    expect(inferHdLeaveHalf({ lateMinutes: 240, earlyOutMinutes: 0, halfSession: null })).toBe("AM");
    expect(inferHdLeaveHalf({ lateMinutes: 0, earlyOutMinutes: 240 })).toBe("PM");
    expect(inferHdLeaveHalf({ lateMinutes: 0, earlyOutMinutes: 0 })).toBeNull();
  });

  it("ignores a value that isn't one of the two halves", () => {
    expect(inferHdLeaveHalf({ lateMinutes: 240, earlyOutMinutes: 0, halfSession: "first" })).toBe(
      "AM",
    );
  });
});

describe("sandwich bridging honours the declared half", () => {
  // Sat 12 Sep 2026 → Sun 13 (week-off) → Mon 14.
  const SAT = "2026-09-12";
  const SUN = "2026-09-13";
  const MON = "2026-09-14";

  it("bridges a Sunday when the declared SECOND half touches it", () => {
    // Declared PM leave on Saturday + absent Monday brackets the Sunday.
    const days = [
      day(SAT, "HD", { late: 240, eo: 0, half: "PM" }), // punches say AM; approval says PM
      day(SUN, "WO"),
      day(MON, "A"),
    ];
    const flips = computeSandwichFlips(days, POLICY);
    expect(flips.map((f) => f.date)).toEqual([SUN]);
  });

  it("does NOT bridge when the declared half faces away from the week-off", () => {
    // Same punches, but the approval says the FIRST half was the leave — the
    // employee worked Saturday afternoon, so nothing touches the Sunday.
    const days = [
      day(SAT, "HD", { late: 0, eo: 240, half: "AM" }), // punches say PM; approval says AM
      day(SUN, "WO"),
      day(MON, "A"),
    ];
    expect(computeSandwichFlips(days, POLICY)).toEqual([]);
  });

  it("closes a sandwich on a declared FIRST half after the week-off", () => {
    const days = [day(SAT, "A"), day(SUN, "WO"), day(MON, "HD", { late: 0, eo: 240, half: "AM" })];
    const flips = computeSandwichFlips(days, POLICY);
    expect(flips.map((f) => f.date)).toEqual([SUN]);
  });

  it("leaves undeclared half-days on the existing punch inference", () => {
    // Regression guard: rows written before this feature carry no half, and
    // must keep bridging exactly as they did.
    const days = [day(SAT, "HD", { late: 0, eo: 240 }), day(SUN, "WO"), day(MON, "A")];
    expect(computeSandwichFlips(days, POLICY).map((f) => f.date)).toEqual([SUN]);
  });
});
