import { describe, it, expect } from "vitest";
import { dayKeyDiff, fromIstWallClock, istDayKey, istDayKeyFrom, parseLooseDate, toIstWallClock } from "@/lib/dates";

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

describe("India calendar helpers", () => {
  it("a picked due date (00:00 UTC) is that same India day", () => {
    // The task composer posts "2026-11-17", stored as 17 Nov 00:00 UTC.
    expect(istDayKey("2026-11-17T00:00:00.000Z")).toBe("2026-11-17");
  });
  it("flips at India midnight, not UTC or browser midnight", () => {
    expect(istDayKey("2026-11-16T18:29:00.000Z")).toBe("2026-11-16"); // 23:59 IST
    expect(istDayKey("2026-11-16T18:30:00.000Z")).toBe("2026-11-17"); // 00:00 IST
  });
  it("is empty for an invalid date", () => {
    expect(istDayKey("nope")).toBe("");
  });
  it("counts days forward across a month end", () => {
    expect(istDayKeyFrom(new Date("2026-11-30T12:00:00+05:30"), 1)).toBe("2026-12-01");
    expect(istDayKeyFrom(new Date("2026-11-16T23:30:00+05:30"), 1)).toBe("2026-11-17");
    expect(dayKeyDiff("2026-11-16", "2026-11-17")).toBe(1);
    expect(dayKeyDiff("2026-11-17", "2026-11-16")).toBe(-1);
    expect(dayKeyDiff("2026-12-31", "2027-01-01")).toBe(1);
  });
  it("round-trips a datetime-local value as India time", () => {
    const at = fromIstWallClock("2026-11-17T10:00");
    expect(at?.toISOString()).toBe("2026-11-17T04:30:00.000Z");
    expect(toIstWallClock(at!)).toBe("2026-11-17T10:00");
    expect(fromIstWallClock("")).toBeNull();
  });
});
