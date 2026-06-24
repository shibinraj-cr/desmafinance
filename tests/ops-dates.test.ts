import { describe, it, expect } from "vitest";
import { addBusinessDays, isWorkingDay } from "@/lib/ops-dates";

// June 2026 reference: the 22nd is a Monday, so the 27th is a Saturday (a
// working day under the Mon–Sat week) and the 28th is a Sunday (off).
const NONE = new Set<string>();

describe("isWorkingDay (Mon–Sat, minus holidays)", () => {
  it("counts Saturday as a working day", () => {
    expect(isWorkingDay("2026-06-27", NONE)).toBe(true); // Sat
  });
  it("excludes Sunday", () => {
    expect(isWorkingDay("2026-06-28", NONE)).toBe(false); // Sun
  });
  it("excludes a weekday that is a holiday", () => {
    expect(isWorkingDay("2026-06-25", new Set(["2026-06-25"]))).toBe(false); // Thu holiday
    expect(isWorkingDay("2026-06-25", NONE)).toBe(true);
  });
});

describe("addBusinessDays", () => {
  it("returns the start date unchanged for 0 (or negative) days", () => {
    expect(addBusinessDays("2026-06-22", 0, NONE)).toBe("2026-06-22");
    expect(addBusinessDays("2026-06-22", -3, NONE)).toBe("2026-06-22");
  });

  it("counts Saturdays as working days, skips Sundays", () => {
    // Mon 22 → Tue23(1) Wed24(2) Thu25(3) Fri26(4) Sat27(5)
    expect(addBusinessDays("2026-06-22", 5, NONE)).toBe("2026-06-27");
    // …Sun28 skipped → Mon29(6)
    expect(addBusinessDays("2026-06-22", 6, NONE)).toBe("2026-06-29");
  });

  it("advances from a Saturday over the Sunday", () => {
    expect(addBusinessDays("2026-06-27", 1, NONE)).toBe("2026-06-29");
  });

  it("skips holidays in addition to Sundays", () => {
    // Thu 25 is a holiday: Tue23(1) Wed24(2) [Thu25 skip] Fri26(3) Sat27(4) [Sun28 skip] Mon29(5)
    expect(addBusinessDays("2026-06-22", 5, new Set(["2026-06-25"]))).toBe("2026-06-29");
  });
});
