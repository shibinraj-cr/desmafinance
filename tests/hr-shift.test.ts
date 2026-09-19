import { describe, it, expect } from "vitest";
import { pickShiftForDate, type ResolvedShift, type ShiftTimeline } from "@/lib/hr-shift";

const shift = (code: string, startTime: string, endTime: string): ResolvedShift => ({
  id: `s-${code}`,
  code,
  name: `Shift ${code}`,
  startTime,
  endTime,
  graceMinutes: 10,
  halfDayCutoffTime: null,
  assignmentId: `a-${code}`,
  fromLegacy: false,
});

const A = shift("A", "09:00", "17:30");
const B = shift("B", "09:30", "18:00");
const LEGACY: ResolvedShift = { ...B, assignmentId: null, fromLegacy: true };

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** A → B on 2026-09-01, i.e. mid-cycle (the 26th→25th cycle starts 26 Aug). */
const AtoB: ShiftTimeline = {
  entries: [
    { from: d("2026-09-01"), to: null, shift: B },
    { from: d("2026-01-01"), to: d("2026-08-31"), shift: A },
  ],
  legacy: LEGACY,
};

describe("pickShiftForDate", () => {
  it("uses the old shift before the change", () => {
    expect(pickShiftForDate(AtoB, d("2026-08-31"))?.code).toBe("A");
  });

  it("uses the new shift from the effective date, mid-cycle", () => {
    // The regression this guards: resolving once at the cycle start (26 Aug)
    // kept scoring the whole of September against Shift A.
    expect(pickShiftForDate(AtoB, d("2026-09-01"))?.code).toBe("B");
    expect(pickShiftForDate(AtoB, d("2026-09-15"))?.code).toBe("B");
  });

  it("treats both window bounds as inclusive", () => {
    expect(pickShiftForDate(AtoB, d("2026-01-01"))?.code).toBe("A");
    expect(pickShiftForDate(AtoB, d("2026-08-31"))?.code).toBe("A");
  });

  it("ignores the time component on the query date", () => {
    const noon = new Date("2026-09-01T12:00:00Z");
    expect(pickShiftForDate(AtoB, noon)?.code).toBe("B");
    // A window ending today still covers a `new Date()` call made during it.
    const closing: ShiftTimeline = {
      entries: [{ from: d("2026-09-01"), to: d("2026-09-19"), shift: A }],
      legacy: LEGACY,
    };
    expect(pickShiftForDate(closing, new Date("2026-09-19T15:30:00Z"))?.code).toBe("A");
  });

  it("falls back to the legacy employee shift for uncovered dates", () => {
    const gapped: ShiftTimeline = {
      entries: [{ from: d("2026-09-01"), to: d("2026-09-10"), shift: A }],
      legacy: LEGACY,
    };
    const picked = pickShiftForDate(gapped, d("2026-09-11"));
    expect(picked?.code).toBe("B");
    expect(picked?.fromLegacy).toBe(true);
  });

  it("returns null when there is no window and no legacy shift", () => {
    expect(pickShiftForDate({ entries: [], legacy: null }, d("2026-09-11"))).toBeNull();
  });

  it("prefers the newest window when two overlap", () => {
    const overlapping: ShiftTimeline = {
      entries: [
        { from: d("2026-09-01"), to: null, shift: B },
        { from: d("2026-01-01"), to: null, shift: A },
      ],
      legacy: LEGACY,
    };
    expect(pickShiftForDate(overlapping, d("2026-09-05"))?.code).toBe("B");
  });
});
