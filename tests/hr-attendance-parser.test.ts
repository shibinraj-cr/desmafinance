/**
 * Attendance status normalisation (src/lib/hr-attendance-parser.ts).
 *
 * Focus: the punch-based half-day (HD) rule. Worked duration is the actual
 * punch-in → out-time, with the out-time capped at the shift end (overtime past
 * shift end does NOT count). Thresholds: weekday < 7h (420 min), Saturday
 * < 5.5h (330 min); below a flat 3h (180 min) floor the day is a full absence
 * (A), not HD. `normaliseStatus` is the parser's UNCAPPED first pass (it has no
 * shift yet); the cap is exercised via `workedMinutesForHalfDay`.
 */
import { describe, it, expect } from "vitest";
import {
  normaliseStatus,
  isSaturdayRuleExempt,
  workedMinutesForHalfDay,
  isHalfDayDuration,
  classifyWorkedDay,
  SATURDAY_END_MIN,
} from "@/lib/hr-attendance-parser";

const TUE = new Date(Date.UTC(2026, 3, 14)); // weekday (threshold 420 / 7h)
const SAT = new Date(Date.UTC(2026, 3, 4)); //  Saturday (threshold 330 / 5.5h)
const SHIFT_A_END = 17 * 60 + 30; // 17:30

describe("normaliseStatus — non-present codes pass through", () => {
  it("maps WO/HL/LV/A/HD and blanks", () => {
    expect(normaliseStatus("WO", TUE, null, null)).toBe("WO");
    expect(normaliseStatus("HL", TUE, null, null)).toBe("HL");
    expect(normaliseStatus("CL", TUE, null, null)).toBe("LV");
    expect(normaliseStatus("A", TUE, null, null)).toBe("A");
    expect(normaliseStatus("HD", TUE, null, null)).toBe("HD");
    expect(normaliseStatus("--", TUE, null, null)).toBe("A");
  });
});

describe("normaliseStatus — punch-based half-day rule (uncapped first pass)", () => {
  it("weekday P with >= 7h stays P; < 7h becomes HD", () => {
    expect(normaliseStatus("P", TUE, "09:00", "17:30")).toBe("P"); // 510m ≥ 420
    expect(normaliseStatus("P", TUE, "09:00", "14:00")).toBe("HD"); // 300m < 420
  });
  it("weekday 7h boundary is a full day (>= threshold, not <)", () => {
    expect(normaliseStatus("P", TUE, "09:00", "16:00")).toBe("P"); // 420m == 420
    expect(normaliseStatus("P", TUE, "09:00", "15:59")).toBe("HD"); // 419m < 420
  });
  it("Saturday uses the 5.5h bar", () => {
    expect(normaliseStatus("P", SAT, "09:00", "14:30")).toBe("P"); // 330m == 330
    expect(normaliseStatus("P", SAT, "09:00", "14:00")).toBe("HD"); // 300m < 330
  });
  it("Work+OT is irrelevant — only the punch span decides", () => {
    // Short punch span → HD regardless of any biometric Work+OT figure.
    expect(normaliseStatus("P", TUE, "09:00", "13:00")).toBe("HD"); // 240m < 420
  });
});

describe("normaliseStatus — under-3h floor becomes full absence (A), not HD", () => {
  it("weekday span < 3h → A", () => {
    expect(normaliseStatus("P", TUE, "09:00", "11:30")).toBe("A"); // 150m < 180
    expect(normaliseStatus("P", TUE, "09:00", "11:59")).toBe("A"); // 179m < 180
  });
  it("exactly 3h is still a half-day, not an absence", () => {
    expect(normaliseStatus("P", TUE, "09:00", "12:00")).toBe("HD"); // 180m == 180 → HD
  });
  it("Saturday span < 3h → A (flat floor, same as weekdays)", () => {
    expect(normaliseStatus("P", SAT, "09:00", "11:30")).toBe("A"); // 150m < 180
    expect(normaliseStatus("P", SAT, "09:00", "12:00")).toBe("HD"); // 180m → HD
  });
  it("a single missing punch stays HD — no duration to measure against the floor", () => {
    expect(normaliseStatus("P", TUE, "09:10", null)).toBe("HD");
  });
});

describe("classifyWorkedDay — absence floor / half-day / present", () => {
  it("weekday: <180 → A, <420 → HD, else P", () => {
    expect(classifyWorkedDay(179, false)).toBe("A");
    expect(classifyWorkedDay(180, false)).toBe("HD");
    expect(classifyWorkedDay(419, false)).toBe("HD");
    expect(classifyWorkedDay(420, false)).toBe("P");
  });
  it("Saturday: <180 → A, <330 → HD, else P", () => {
    expect(classifyWorkedDay(179, true)).toBe("A");
    expect(classifyWorkedDay(180, true)).toBe("HD");
    expect(classifyWorkedDay(329, true)).toBe("HD");
    expect(classifyWorkedDay(330, true)).toBe("P");
  });
});

describe("normaliseStatus — real punch-span examples", () => {
  it("weekday: short span → HD (Aswathi 23 Apr: 09:04–13:32)", () => {
    expect(normaliseStatus("P", TUE, "09:04", "13:32")).toBe("HD"); // 268m < 420
  });
  it("weekday: early-in counts toward the full day (Vijayalakshmi 06 Apr: 08:45–17:30)", () => {
    expect(normaliseStatus("P", TUE, "8:45", "17:30")).toBe("P"); // 525m ≥ 420
  });
  it("Saturday: 4h span → HD under the 5.5h bar (Soumya 04 Apr: 09:01–13:04)", () => {
    expect(normaliseStatus("P", SAT, "09:01", "13:04")).toBe("HD"); // 243m < 330
  });
  it("no punches and explicit P → stays P (nothing to infer from)", () => {
    expect(normaliseStatus("P", TUE, null, null)).toBe("P");
  });
});

describe("normaliseStatus — missing punch (one of in/out) → half-day", () => {
  it("in-only weekday → HD", () => {
    expect(normaliseStatus("P", TUE, "09:10", null)).toBe("HD");
  });
  it("out-only with blank '--:--' status → HD (Sivapriya 17 Apr)", () => {
    expect(normaliseStatus("--:--", TUE, null, "17:34")).toBe("HD");
  });
  it("'--:--' with NO punch → A (absent)", () => {
    expect(normaliseStatus("--:--", TUE, null, null)).toBe("A");
  });
  it("a stray single punch on a week-off / holiday stays WO / HL", () => {
    expect(normaliseStatus("WO", TUE, "09:10", null)).toBe("WO");
    expect(normaliseStatus("HL", TUE, null, "17:00")).toBe("HL");
  });
});

describe("workedMinutesForHalfDay — out-time capped at the shift end", () => {
  it("caps overtime past the shift end (weekday)", () => {
    // Late in (11:40) + very late out (19:00): uncapped span is 440m (a full day),
    // but the OT past 17:30 must not count — capped span is 350m.
    expect(workedMinutesForHalfDay("11:40", "19:00", null)).toBe(440);
    expect(workedMinutesForHalfDay("11:40", "19:00", SHIFT_A_END)).toBe(350);
  });
  it("leaves the out-time untouched when it's before the shift end", () => {
    expect(workedMinutesForHalfDay("09:00", "16:00", SHIFT_A_END)).toBe(420);
  });
  it("counts early punch-in as recorded (in is never clamped up)", () => {
    expect(workedMinutesForHalfDay("08:40", "17:30", SHIFT_A_END)).toBe(530);
  });
  it("caps Saturday at 16:00", () => {
    expect(workedMinutesForHalfDay("10:00", "18:30", SATURDAY_END_MIN)).toBe(360);
  });
  it("returns null when a punch is missing", () => {
    expect(workedMinutesForHalfDay("09:00", null, SHIFT_A_END)).toBeNull();
    expect(workedMinutesForHalfDay(null, "17:30", SHIFT_A_END)).toBeNull();
  });
  it("returns null when the span is non-positive (incl. after capping)", () => {
    expect(workedMinutesForHalfDay("17:30", "09:00", null)).toBeNull();
    expect(workedMinutesForHalfDay("18:00", "19:00", SHIFT_A_END)).toBeNull(); // both past cap
  });
});

describe("isHalfDayDuration — threshold edges", () => {
  it("weekday: < 420 is HD, 420 is a full day", () => {
    expect(isHalfDayDuration(419, false)).toBe(true);
    expect(isHalfDayDuration(420, false)).toBe(false);
  });
  it("Saturday: < 330 is HD, 330 is a full day", () => {
    expect(isHalfDayDuration(329, true)).toBe(true);
    expect(isHalfDayDuration(330, true)).toBe(false);
  });
});

describe("half-day cap — parser first pass vs authoritative recompute", () => {
  it("a gross-full weekday flips to HD once the out-time is capped at the shift end", () => {
    // in 11:40, out 19:00, Shift A (ends 17:30).
    const uncapped = workedMinutesForHalfDay("11:40", "19:00", null)!;
    const capped = workedMinutesForHalfDay("11:40", "19:00", SHIFT_A_END)!;
    expect(isHalfDayDuration(uncapped, false)).toBe(false); // parser: 440m → P
    expect(isHalfDayDuration(capped, false)).toBe(true); //   route:  350m → HD
  });
  it("a late-afternoon punch drops from HD to A once OT past the shift end is capped off", () => {
    // in 15:00, out 20:00, Shift A (ends 17:30): the parser sees 300m (HD), but the
    // authoritative capped span is 150m (< 3h) → the day is a full absence.
    const uncapped = workedMinutesForHalfDay("15:00", "20:00", null)!;
    const capped = workedMinutesForHalfDay("15:00", "20:00", SHIFT_A_END)!;
    expect(classifyWorkedDay(uncapped, false)).toBe("HD"); // parser: 300m → HD
    expect(classifyWorkedDay(capped, false)).toBe("A"); //    route:  150m → A
  });
});

describe("isSaturdayRuleExempt", () => {
  it("exempts Nithya (any biometric name containing it) from the 9–4 Saturday rule", () => {
    expect(isSaturdayRuleExempt("Nithya")).toBe(true);
    expect(isSaturdayRuleExempt("NITHYA K")).toBe(true);
  });
  it("everyone else follows the standard Saturday rule", () => {
    expect(isSaturdayRuleExempt("Sivapriya Sivakumar")).toBe(false);
    expect(isSaturdayRuleExempt("")).toBe(false);
  });
});
