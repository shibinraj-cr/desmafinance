import { describe, it, expect } from "vitest";
import { parseLooseDate } from "@/lib/dates";

describe("parseLooseDate", () => {
  it("returns null for null/undefined/empty/invalid", () => {
    expect(parseLooseDate(null)).toBeNull();
    expect(parseLooseDate(undefined)).toBeNull();
    expect(parseLooseDate("")).toBeNull();
    expect(parseLooseDate("not a date")).toBeNull();
    expect(parseLooseDate({})).toBeNull();
  });

  it("passes through valid Date instances", () => {
    const d = new Date(2026, 3, 15);
    expect(parseLooseDate(d)).toBe(d);
  });

  it("rejects an Invalid Date instance", () => {
    expect(parseLooseDate(new Date("nope"))).toBeNull();
  });

  it("converts Excel serial numbers to JS Date", () => {
    // Excel's epoch is 1899-12-30 (with the famous Lotus leap-year bug accounted for).
    // Compute the correct serial dynamically rather than hardcoding it.
    const epoch = Date.UTC(1899, 11, 30);
    const target = Date.UTC(2026, 3, 30);
    const serial = (target - epoch) / 86400000;
    const d = parseLooseDate(serial);
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(3);
    expect(d!.getUTCDate()).toBe(30);
  });

  it("parses Indian dd-mm-yyyy strings (the bug the importer had)", () => {
    const d = parseLooseDate("30-04-2026");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(3);
    expect(d!.getUTCDate()).toBe(30);
  });

  it("parses dd/mm/yyyy as well", () => {
    const d = parseLooseDate("23/04/2026");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(3);
    expect(d!.getUTCDate()).toBe(23);
  });

  it("does NOT swap dd-mm-yyyy to mm-dd-yyyy (a regression guard)", () => {
    // 03-04-2026 must mean April 3, not March 4 — this is the whole point of the fix.
    const d = parseLooseDate("03-04-2026")!;
    expect(d.getUTCMonth()).toBe(3); // April
    expect(d.getUTCDate()).toBe(3);
  });

  it("falls back to native parsing for ISO strings", () => {
    const d = parseLooseDate("2026-04-30T00:00:00Z");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(3);
    expect(d!.getUTCDate()).toBe(30);
  });

  it("trims surrounding whitespace before parsing", () => {
    const d = parseLooseDate("  30-04-2026  ");
    expect(d).not.toBeNull();
    expect(d!.getUTCDate()).toBe(30);
  });
});
