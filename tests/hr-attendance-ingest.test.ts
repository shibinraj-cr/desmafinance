import { describe, it, expect } from "vitest";
import {
  clampWindowStart,
  filterRowsFromFloor,
  resolveReplaceWindow,
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

describe("resolveReplaceWindow", () => {
  // September salary cycle: 26 Aug → 25 Sep.
  const CYCLE = { cycleStart: d("2026-08-26"), cycleEnd: d("2026-09-25") };

  it("replaces the whole cycle when no fetched range is given (file upload)", () => {
    // A month spreadsheet covers the cycle, so full-window replace is correct.
    const w = resolveReplaceWindow({ ...CYCLE });
    expect(w).toEqual({ start: d("2026-08-26"), end: d("2026-09-25") });
  });

  it("confines the replace to a partial fetched range (the sync's lookback)", () => {
    // THE REGRESSION: a 10-day pull used to delete the whole 30-day cycle and
    // recreate only these 10 days, destroying 26 Aug – 8 Sep on every tick.
    const w = resolveReplaceWindow({
      ...CYCLE,
      replaceFrom: d("2026-09-09"),
      replaceTo: d("2026-09-18"),
    });
    expect(w).toEqual({ start: d("2026-09-09"), end: d("2026-09-18") });
  });

  it("leaves earlier days in the cycle outside the replace window", () => {
    const w = resolveReplaceWindow({
      ...CYCLE,
      replaceFrom: d("2026-09-09"),
      replaceTo: d("2026-09-18"),
    })!;
    // 1 Sep is in the cycle but was not fetched → must survive, so the employee
    // can still file a leave request against that day.
    expect(d("2026-09-01") < w.start).toBe(true);
  });

  it("never reaches before the date floor, even when asked to", () => {
    // Floor inside the cycle: it wins over both the cycle start and the
    // caller's earlier replaceFrom.
    const w = resolveReplaceWindow({
      ...CYCLE,
      dateFloor: d("2026-09-05"),
      replaceFrom: d("2026-06-01"),
      replaceTo: d("2026-09-18"),
    });
    expect(w).toEqual({ start: d("2026-09-05"), end: d("2026-09-18") });
  });

  it("a fetched range starting before the cycle cannot widen the window", () => {
    const w = resolveReplaceWindow({
      ...CYCLE,
      dateFloor: CUTOVER,
      replaceFrom: d("2026-06-01"),
      replaceTo: d("2026-09-18"),
    });
    // Cutover (26 Jun) is earlier than the cycle start, so the cycle start holds.
    expect(w).toEqual({ start: d("2026-08-26"), end: d("2026-09-18") });
  });

  it("clamps a fetched range that overruns the cycle end", () => {
    // A lookback straddling the 25th buckets into two cycles; each cycle may
    // only replace its own days.
    const w = resolveReplaceWindow({
      ...CYCLE,
      replaceFrom: d("2026-09-20"),
      replaceTo: d("2026-09-29"),
    });
    expect(w).toEqual({ start: d("2026-09-20"), end: d("2026-09-25") });
  });

  it("returns null when the fetched range misses the cycle entirely", () => {
    expect(
      resolveReplaceWindow({ ...CYCLE, replaceFrom: d("2026-09-26"), replaceTo: d("2026-09-29") }),
    ).toBeNull();
  });
});
