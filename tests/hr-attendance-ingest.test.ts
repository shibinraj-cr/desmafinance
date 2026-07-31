import { describe, it, expect } from "vitest";
import {
  clampWindowStart,
  filterRowsFromFloor,
  ATTENDANCE_API_CUTOVER,
  SECOND_HALF_RULE_CUTOVER,
} from "@/lib/hr-attendance-ingest";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
// Cutover = start of the July salary cycle (26 Jun → 25 Jul).
const CUTOVER = d("2026-06-26");

describe("clampWindowStart", () => {
  it("returns the cycle start unchanged when there is no floor", () => {
    const start = d("2026-05-26");
    expect(clampWindowStart(start, null)).toBe(start);
    expect(clampWindowStart(start, undefined)).toBe(start);
  });

  it("lifts the start to the floor when the cycle begins before it (June cycle)", () => {
    // June salary cycle window is 26 May → 25 Jun; the floor must win so the
    // sync can't reach back into the June cycle.
    const juneCycleStart = d("2026-05-26");
    expect(clampWindowStart(juneCycleStart, CUTOVER)).toBe(CUTOVER);
  });

  it("keeps the cycle start when it already equals the floor (July cycle)", () => {
    // The July cycle starts exactly on the cutover → no clamp, full-window own.
    const julyCycleStart = d("2026-06-26");
    expect(clampWindowStart(julyCycleStart, CUTOVER)).toBe(julyCycleStart);
  });

  it("keeps the cycle start when it is after the floor (August cycle)", () => {
    const augCycleStart = d("2026-07-26");
    expect(clampWindowStart(augCycleStart, CUTOVER)).toBe(augCycleStart);
  });
});

describe("filterRowsFromFloor", () => {
  const rows = [
    { date: d("2026-06-24"), tag: "jun24" },
    { date: d("2026-06-25"), tag: "jun25" },
    { date: d("2026-06-26"), tag: "jun26" },
    { date: d("2026-07-10"), tag: "jul10" },
  ];

  it("drops every row before the cutover (the June cycle is never touched)", () => {
    const kept = filterRowsFromFloor(rows, CUTOVER).map((r) => r.tag);
    expect(kept).toEqual(["jun26", "jul10"]);
  });

  it("keeps the cutover day itself (inclusive floor)", () => {
    expect(filterRowsFromFloor(rows, CUTOVER).some((r) => r.tag === "jun26")).toBe(true);
  });

  it("returns everything when there is no floor (file-upload path)", () => {
    expect(filterRowsFromFloor(rows, null)).toHaveLength(4);
  });
});

describe("ATTENDANCE_API_CUTOVER", () => {
  it("defaults to 2026-06-26 UTC midnight", () => {
    // (Unless overridden by ETIMEOFFICE_SYNC_FROM in the environment.)
    if (!process.env.ETIMEOFFICE_SYNC_FROM) {
      expect(ATTENDANCE_API_CUTOVER.toISOString()).toBe("2026-06-26T00:00:00.000Z");
    }
  });
});

describe("SECOND_HALF_RULE_CUTOVER", () => {
  it("defaults to 2026-06-26 UTC midnight (July cycle start)", () => {
    // (Unless overridden by SECOND_HALF_RULE_FROM in the environment.)
    if (!process.env.SECOND_HALF_RULE_FROM) {
      expect(SECOND_HALF_RULE_CUTOVER.toISOString()).toBe("2026-06-26T00:00:00.000Z");
    }
  });
});
