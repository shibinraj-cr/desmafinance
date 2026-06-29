import { describe, it, expect } from "vitest";
import {
  computeSandwichFlips,
  reconcileSandwich,
  inferHdLeaveHalf,
  type SandwichDay,
  type SandwichReconcileDay,
} from "@/lib/hr-sandwich";

const POLICY = { includeHolidays: true, includeWeekOffs: true, maxGapDays: 7 };

let seq = 0;
function day(date: string, status: string, opts: { late?: number; eo?: number } = {}): SandwichDay {
  return {
    id: `d${seq++}`,
    date: new Date(`${date}T00:00:00Z`),
    status,
    lateMinutes: opts.late ?? 0,
    earlyOutMinutes: opts.eo ?? 0,
  };
}

// HD where the employee arrived late → morning missing → 1st half (AM) leave.
const hdAM = (date: string) => day(date, "HD", { late: 240, eo: 0 });
// HD where the employee left early → afternoon missing → 2nd half (PM) leave.
const hdPM = (date: string) => day(date, "HD", { late: 0, eo: 240 });

const flippedDates = (days: SandwichDay[]) => computeSandwichFlips(days, POLICY).map((f) => f.date);

describe("inferHdLeaveHalf", () => {
  it("arrived late → AM (1st half) leave", () => {
    expect(inferHdLeaveHalf({ lateMinutes: 289, earlyOutMinutes: 0 })).toBe("AM");
  });
  it("left early → PM (2nd half) leave", () => {
    expect(inferHdLeaveHalf({ lateMinutes: 3, earlyOutMinutes: 259 })).toBe("PM");
  });
  it("ambiguous (both zero) → null", () => {
    expect(inferHdLeaveHalf({ lateMinutes: 0, earlyOutMinutes: 0 })).toBeNull();
  });
});

describe("computeSandwichFlips — full-day leaves (baseline, unchanged)", () => {
  it("A … WO … A flips the week-off", () => {
    // Sat A, Sun WO, Mon A  →  Sunday sandwiched.
    const days = [day("2026-05-02", "A"), day("2026-05-03", "WO"), day("2026-05-04", "A")];
    expect(flippedDates(days)).toEqual(["2026-05-03"]);
  });

  it("does not flip when only one side is leave", () => {
    const days = [day("2026-05-02", "A"), day("2026-05-03", "WO"), day("2026-05-04", "P")];
    expect(flippedDates(days)).toEqual([]);
  });

  it("respects maxGapDays", () => {
    const tight = { ...POLICY, maxGapDays: 2 };
    // A, WO, WO, WO, A → gap of 4 (> 2) → no flip.
    const days = [
      day("2026-05-01", "A"),
      day("2026-05-02", "WO"),
      day("2026-05-03", "WO"),
      day("2026-05-04", "WO"),
      day("2026-05-05", "A"),
    ];
    expect(computeSandwichFlips(days, tight)).toEqual([]);
  });
});

describe("computeSandwichFlips — half-day awareness (Shency rule)", () => {
  // Saturday is a working day; Sunday is the week-off; Monday is working.
  it("Shency case: Sat 1st-half (AM) leave + Mon leave → NO sandwich", () => {
    const days = [hdAM("2026-05-02"), day("2026-05-03", "WO"), day("2026-05-04", "A")];
    expect(flippedDates(days)).toEqual([]);
  });

  it("Sat 2nd-half (PM) leave + Mon leave → sandwich applies", () => {
    const days = [hdPM("2026-05-02"), day("2026-05-03", "WO"), day("2026-05-04", "A")];
    expect(flippedDates(days)).toEqual(["2026-05-03"]);
  });

  it("symmetric: Fri leave + Mon 1st-half (AM) leave → sandwich applies", () => {
    // Fri A, Sat WO?, here: A, WO, HD(AM) — AM touches the preceding week-off.
    const days = [day("2026-05-01", "A"), day("2026-05-02", "WO"), hdAM("2026-05-04")];
    expect(flippedDates(days)).toEqual(["2026-05-02"]);
  });

  it("symmetric: Fri leave + Mon 2nd-half (PM) leave → NO sandwich", () => {
    // PM leave on Monday means the employee was present Monday morning, right
    // after the week-off → the bridge is not closed.
    const days = [day("2026-05-01", "A"), day("2026-05-02", "WO"), hdPM("2026-05-04")];
    expect(flippedDates(days)).toEqual([]);
  });

  it("HD(PM) … WO … HD(AM) → sandwich applies (both halves touch the bridge)", () => {
    const days = [hdPM("2026-05-02"), day("2026-05-03", "WO"), hdAM("2026-05-04")];
    expect(flippedDates(days)).toEqual(["2026-05-03"]);
  });

  it("HD(AM) … WO … HD(PM) → NO sandwich (neither half touches the bridge)", () => {
    const days = [hdAM("2026-05-02"), day("2026-05-03", "WO"), hdPM("2026-05-04")];
    expect(flippedDates(days)).toEqual([]);
  });
});

describe("reconcileSandwich — self-correcting flip + revert", () => {
  let s = 0;
  function rday(
    date: string,
    status: string,
    opts: { raw?: string | null; note?: string | null; late?: number; eo?: number } = {},
  ): SandwichReconcileDay {
    return {
      id: `r${s++}`,
      date: new Date(`${date}T00:00:00Z`),
      status,
      lateMinutes: opts.late ?? 0,
      earlyOutMinutes: opts.eo ?? 0,
      rawStatus: opts.raw ?? status,
      decisionNote: opts.note ?? null,
    };
  }
  // A prior sandwich flip: stored A, original WO, carrying the sandwich note.
  const priorFlip = (date: string) =>
    rday(date, "A", { raw: "WO", note: "Sandwich rule (WO → A)" });

  it("flips a newly-sandwiched week-off (A … WO … A)", () => {
    const r = reconcileSandwich(
      [rday("2026-05-02", "A"), rday("2026-05-03", "WO"), rday("2026-05-04", "A")],
      POLICY,
    );
    expect(r.flip.map((f) => f.date)).toEqual(["2026-05-03"]);
    expect(r.revert).toEqual([]);
  });

  it("leaves an already-correct flip untouched (idempotent)", () => {
    const r = reconcileSandwich(
      [rday("2026-05-02", "A"), priorFlip("2026-05-03"), rday("2026-05-04", "A")],
      POLICY,
    );
    expect(r.flip).toEqual([]);
    expect(r.revert).toEqual([]);
  });

  it("reverts a stale flip when an anchor is no longer leave (P … flip … A)", () => {
    // The left anchor became Present (e.g. a punch fix), so the bridge is no
    // longer sandwiched and must revert to its original WO.
    const r = reconcileSandwich(
      [rday("2026-05-02", "P"), priorFlip("2026-05-03"), rday("2026-05-04", "A")],
      POLICY,
    );
    expect(r.flip).toEqual([]);
    expect(r.revert.map((x) => `${x.date}→${x.to}`)).toEqual(["2026-05-03→WO"]);
  });
});
