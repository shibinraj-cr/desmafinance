import { describe, it, expect } from "vitest";
import {
  ageFromDob,
  dobRangeForAge,
  parseAgeParam,
  parseDobInput,
  parseDobCell,
} from "@/lib/age";

// Fixed "now" so the age math is deterministic. 2026-07-09 (UTC).
const NOW = new Date("2026-07-09T10:30:00.000Z");

describe("ageFromDob", () => {
  it("returns whole years for a birthday already passed this year", () => {
    expect(ageFromDob("2000-01-01", NOW)).toBe(26);
  });

  it("does not count a birthday that hasn't happened yet this year", () => {
    // Turns 26 on 2026-08-01, still 25 on 2026-07-09.
    expect(ageFromDob("2000-08-01", NOW)).toBe(25);
  });

  it("counts a birthday that falls exactly on today", () => {
    expect(ageFromDob("2001-07-09", NOW)).toBe(25);
  });

  it("is 0 for an infant born earlier this year", () => {
    expect(ageFromDob("2026-01-01", NOW)).toBe(0);
  });

  it("accepts a Date as well as a string", () => {
    expect(ageFromDob(new Date("1990-07-09T00:00:00.000Z"), NOW)).toBe(36);
  });

  it("returns null for missing / invalid / future dates", () => {
    expect(ageFromDob(null, NOW)).toBeNull();
    expect(ageFromDob(undefined, NOW)).toBeNull();
    expect(ageFromDob("not-a-date", NOW)).toBeNull();
    expect(ageFromDob("2030-01-01", NOW)).toBeNull(); // future
  });
});

describe("dobRangeForAge — inclusive [minAge, maxAge] → dob bounds", () => {
  it("maps a minimum age to a dob upper bound (born on/before N years ago)", () => {
    const r = dobRangeForAge(25, undefined, NOW);
    expect(r?.lte).toEqual(new Date(Date.UTC(2001, 6, 9))); // 2026 - 25
    expect(r?.gte).toBeUndefined();
  });

  it("maps a maximum age to a dob lower bound (excludes the (max+1)-th birthday today)", () => {
    const r = dobRangeForAge(undefined, 30, NOW);
    // 2026 - 31, then +1 day so someone turning 31 exactly today is excluded.
    expect(r?.gte).toEqual(new Date(Date.UTC(1995, 6, 10)));
    expect(r?.lte).toBeUndefined();
  });

  it("combines both bounds for a range", () => {
    const r = dobRangeForAge(25, 30, NOW);
    expect(r?.lte).toEqual(new Date(Date.UTC(2001, 6, 9)));
    expect(r?.gte).toEqual(new Date(Date.UTC(1995, 6, 10)));
  });

  it("returns null when neither bound is given", () => {
    expect(dobRangeForAge(undefined, undefined, NOW)).toBeNull();
  });

  it("round-trips: the boundary dobs actually compute to the filtered ages", () => {
    const r = dobRangeForAge(25, 30, NOW)!;
    // Oldest included: dob === gte → age 30. Youngest included: dob === lte → age 25.
    expect(ageFromDob(r.gte!, NOW)).toBe(30);
    expect(ageFromDob(r.lte!, NOW)).toBe(25);
    // One day outside each bound falls out of the [25,30] window.
    const dayBeforeGte = new Date(r.gte!.getTime() - 24 * 3600 * 1000);
    const dayAfterLte = new Date(r.lte!.getTime() + 24 * 3600 * 1000);
    expect(ageFromDob(dayBeforeGte, NOW)).toBe(31);
    expect(ageFromDob(dayAfterLte, NOW)).toBe(24);
  });
});

describe("parseAgeParam", () => {
  it("parses a valid integer string", () => {
    expect(parseAgeParam("30")).toBe(30);
    expect(parseAgeParam("0")).toBe(0);
  });
  it("rejects empty / null / non-numeric / out-of-range", () => {
    expect(parseAgeParam(undefined)).toBeUndefined();
    expect(parseAgeParam(null)).toBeUndefined();
    expect(parseAgeParam("")).toBeUndefined();
    expect(parseAgeParam("abc")).toBeUndefined();
    expect(parseAgeParam("-3")).toBeUndefined();
    expect(parseAgeParam("999")).toBeUndefined();
  });
});

describe("parseDobInput — form value → Date | null | undefined", () => {
  it("distinguishes not-provided from cleared", () => {
    expect(parseDobInput(undefined)).toBeUndefined();
    expect(parseDobInput(null)).toBeNull();
    expect(parseDobInput("")).toBeNull();
    expect(parseDobInput("  ")).toBeNull();
  });
  it("parses YYYY-MM-DD to UTC midnight", () => {
    expect(parseDobInput("1999-05-21")).toEqual(new Date("1999-05-21T00:00:00.000Z"));
  });
  it("throws on a malformed value", () => {
    expect(() => parseDobInput("21/05/1999")).toThrow();
    expect(() => parseDobInput("1999-13-40")).toThrow();
  });
});

describe("parseDobCell — spreadsheet cell → Date | null (never throws)", () => {
  it("reads a real Excel Date cell as a date-only UTC value", () => {
    expect(parseDobCell(new Date("1998-03-15T18:00:00.000Z"))).toEqual(
      new Date(Date.UTC(1998, 2, 15)),
    );
  });
  it("parses ISO strings", () => {
    expect(parseDobCell("1998-03-15")).toEqual(new Date(Date.UTC(1998, 2, 15)));
  });
  it("parses day-first DD/MM/YYYY and DD-MM-YYYY", () => {
    expect(parseDobCell("15/03/1998")).toEqual(new Date(Date.UTC(1998, 2, 15)));
    expect(parseDobCell("15-03-1998")).toEqual(new Date(Date.UTC(1998, 2, 15)));
  });
  it("swaps to month-first when the second component is clearly the day (>12)", () => {
    expect(parseDobCell("03/15/1998")).toEqual(new Date(Date.UTC(1998, 2, 15)));
  });
  it("returns null for empty or unrecognised values (no throw)", () => {
    expect(parseDobCell(null)).toBeNull();
    expect(parseDobCell("")).toBeNull();
    expect(parseDobCell("sometime in 1998")).toBeNull();
    expect(parseDobCell("31/02/1998")).toBeNull(); // impossible date
  });
});
