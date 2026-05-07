import { describe, it, expect } from "vitest";
import { inr, inrFull, pct, monthLabel } from "@/lib/format";

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
