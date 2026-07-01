/**
 * Attendance status normalisation (src/lib/hr-attendance-parser.ts).
 *
 * Focus: the half-day (HD) rule and its gross-punch-duration fallback for when
 * the biometric "Work+OT" column is blank — the bug that left genuine half-days
 * (and full days) misclassified across the April-2026 cycle.
 */
import { describe, it, expect } from "vitest";
import { normaliseStatus, isSaturdayRuleExempt } from "@/lib/hr-attendance-parser";

const TUE = new Date(Date.UTC(2026, 3, 14)); // weekday (threshold 360)
const SAT = new Date(Date.UTC(2026, 3, 4)); //  Saturday (threshold 210)

describe("normaliseStatus — non-present codes pass through", () => {
  it("maps WO/HL/LV/A/HD and blanks", () => {
    expect(normaliseStatus("WO", 0, 0, TUE, null, null)).toBe("WO");
    expect(normaliseStatus("HL", 0, 0, TUE, null, null)).toBe("HL");
    expect(normaliseStatus("CL", 0, 0, TUE, null, null)).toBe("LV");
    expect(normaliseStatus("A", 0, 0, TUE, null, null)).toBe("A");
    expect(normaliseStatus("HD", 0, 0, TUE, null, null)).toBe("HD");
    expect(normaliseStatus("--", 0, 0, TUE, null, null)).toBe("A");
  });
});

describe("normaliseStatus — half-day rule from Work+OT minutes", () => {
  it("weekday P with >= 6h stays P; < 6h becomes HD", () => {
    expect(normaliseStatus("P", 420, 0, TUE, "09:00", "17:30")).toBe("P");
    expect(normaliseStatus("P", 300, 0, TUE, "09:00", "14:00")).toBe("HD");
  });
  it("Saturday P uses the 3.5h bar", () => {
    expect(normaliseStatus("P", 240, 0, SAT, "09:00", "13:00")).toBe("P"); // 4h ≥ 3.5h
    expect(normaliseStatus("P", 180, 0, SAT, "09:00", "12:00")).toBe("HD"); // 3h < 3.5h
  });
});

describe("normaliseStatus — gross-duration fallback when Work+OT is blank (0)", () => {
  it("weekday: short punch span → HD (Aswathi 23 Apr: 09:04–13:32)", () => {
    expect(normaliseStatus("P", 0, 0, TUE, "09:04", "13:32")).toBe("HD"); // 268m < 360
  });
  it("weekday: full punch span → P (Vijayalakshmi 06 Apr: 08:45–17:30)", () => {
    expect(normaliseStatus("P", 0, 0, TUE, "8:45", "17:30")).toBe("P"); // 525m ≥ 360
  });
  it("Saturday: 4h punch span → P (Soumya 04 Apr: 09:01–13:04)", () => {
    expect(normaliseStatus("P", 0, 0, SAT, "09:01", "13:04")).toBe("P"); // 243m ≥ 210
  });
  it("Saturday: short punch span → HD", () => {
    expect(normaliseStatus("P", 0, 0, SAT, "09:00", "11:30")).toBe("HD"); // 150m < 210
  });
  it("no punches and no Work+OT → stays P (nothing to infer from)", () => {
    expect(normaliseStatus("P", 0, 0, TUE, null, null)).toBe("P");
  });
  it("does not override a real Work+OT value with gross", () => {
    // Work+OT present (full day) wins even if punch span happens to be short.
    expect(normaliseStatus("P", 480, 0, TUE, "09:00", "13:00")).toBe("P");
  });
});

describe("normaliseStatus — missing punch (one of in/out) → half-day", () => {
  it("in-only weekday → HD", () => {
    expect(normaliseStatus("P", 0, 0, TUE, "09:10", null)).toBe("HD");
  });
  it("out-only with blank '--:--' status → HD (Sivapriya 17 Apr)", () => {
    expect(normaliseStatus("--:--", 0, 0, TUE, null, "17:34")).toBe("HD");
  });
  it("'--:--' with NO punch → A (absent)", () => {
    expect(normaliseStatus("--:--", 0, 0, TUE, null, null)).toBe("A");
  });
  it("a stray single punch on a week-off / holiday stays WO / HL", () => {
    expect(normaliseStatus("WO", 0, 0, TUE, "09:10", null)).toBe("WO");
    expect(normaliseStatus("HL", 0, 0, TUE, null, "17:00")).toBe("HL");
  });
  it("explicit biometric P with no punches at all is trusted as P", () => {
    expect(normaliseStatus("P", 0, 0, TUE, null, null)).toBe("P");
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
