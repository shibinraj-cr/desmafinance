import { describe, it, expect } from "vitest";
import { inr, inrCompact, inrFull, pct, monthLabel } from "@/lib/format";

describe("inr", () => {
  it("returns ₹0 for null/undefined/NaN", () => {
    expect(inr(null)).toBe("₹0");
    expect(inr(undefined)).toBe("₹0");
    expect(inr(NaN)).toBe("₹0");
  });

  it("formats lakhs with the L suffix", () => {
    expect(inr(10_00_000)).toBe("₹10.00L");
    expect(inr(33_07_000)).toBe("₹33.07L");
    expect(inr(1_00_00_000)).toBe("₹100.00L");
  });

  it("formats thousands with Indian grouping", () => {
    expect(inr(1_000)).toBe("₹1,000");
    expect(inr(50_000)).toBe("₹50,000");
    expect(inr(99_999)).toBe("₹99,999");
  });

  it("formats sub-thousand integers", () => {
    expect(inr(0)).toBe("₹0");
    expect(inr(500)).toBe("₹500");
  });

  it("accepts a Decimal-like .toString() shape", () => {
    expect(inr({ toString: () => "33_07_000".replace(/_/g, "") } as { toString(): string })).toBe(
      "₹33.07L",
    );
  });
});

describe("inrFull", () => {
  it("never abbreviates and shows two decimals when needed", () => {
    expect(inrFull(33_07_124.56)).toBe("₹33,07,124.56");
    expect(inrFull(0)).toBe("₹0");
    expect(inrFull(null)).toBe("₹0");
  });
});

describe("pct", () => {
  it("returns 0 when total is 0", () => {
    expect(pct(5, 0)).toBe(0);
  });

  it("computes integer percentages", () => {
    expect(pct(25, 100)).toBe(25);
    expect(pct(1, 3)).toBe(33);
  });
});

describe("monthLabel", () => {
  it("formats Indian fiscal-style Mon-YY", () => {
    // Month is 0-indexed in JS Date.
    expect(monthLabel(new Date(2026, 3, 15))).toBe("Apr-26");
    expect(monthLabel(new Date(2027, 0, 1))).toBe("Jan-27");
  });
});

describe("inrCompact", () => {
  it("switches to crores at one crore", () => {
    expect(inrCompact(99_99_999)).toBe("₹100.00 L");
    expect(inrCompact(1_00_00_000)).toBe("₹1.00 Cr");
    expect(inrCompact(2_12_55_320)).toBe("₹2.13 Cr");
  });

  it("uses lakhs from one lakh up", () => {
    expect(inrCompact(1_00_000)).toBe("₹1.00 L");
    expect(inrCompact(65_21_000)).toBe("₹65.21 L");
    // Two decimals, so a gold vault re-priced by a ₹1/g move still reads as a
    // change rather than rounding away.
    expect(inrCompact(48_35_000)).toBe("₹48.35 L");
  });

  it("writes smaller amounts in full, grouped Indian-style", () => {
    expect(inrCompact(28_500)).toBe("₹28,500");
    expect(inrCompact(927)).toBe("₹927");
    expect(inrCompact(0)).toBe("₹0");
  });

  it("keeps the sign on a negative figure", () => {
    expect(inrCompact(-1_90_50_000)).toBe("₹-1.91 Cr");
    expect(inrCompact(-5_000)).toBe("₹-5,000");
  });

  it("treats missing and non-finite input as zero", () => {
    expect(inrCompact(null)).toBe("₹0");
    expect(inrCompact(undefined)).toBe("₹0");
    expect(inrCompact(Number.NaN)).toBe("₹0");
  });
});
