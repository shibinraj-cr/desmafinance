import { describe, it, expect } from "vitest";
import {
  addDays,
  isWithinBackdateWindow,
  toPrismaDate,
  fromPrismaDate,
  firstOfMonth,
} from "@/lib/lead-pulse-dates";

describe("addDays", () => {
  it("adds positive days", () => {
    expect(addDays("2026-05-08", 1)).toBe("2026-05-09");
  });
  it("crosses month boundary backwards", () => {
    expect(addDays("2026-05-01", -1)).toBe("2026-04-30");
  });
  it("crosses leap year correctly (2024 was a leap year)", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
  });
});

describe("isWithinBackdateWindow", () => {
  const today = "2026-05-08";
  it("allows today", () => {
    expect(isWithinBackdateWindow(today, today)).toBe(true);
  });
  it("allows 3 days back", () => {
    expect(isWithinBackdateWindow("2026-05-05", today)).toBe(true);
  });
  it("rejects 4 days back", () => {
    expect(isWithinBackdateWindow("2026-05-04", today)).toBe(false);
  });
  it("rejects future dates", () => {
    expect(isWithinBackdateWindow("2026-05-09", today)).toBe(false);
  });
});

describe("toPrismaDate / fromPrismaDate round-trip", () => {
  it("preserves the calendar date through the round-trip", () => {
    const start = "2026-05-08";
    expect(fromPrismaDate(toPrismaDate(start))).toBe(start);
  });
});

describe("firstOfMonth", () => {
  it("returns the 1st", () => {
    expect(firstOfMonth("2026-05-23")).toBe("2026-05-01");
  });
});
