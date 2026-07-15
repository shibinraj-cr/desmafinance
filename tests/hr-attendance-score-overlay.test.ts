/**
 * Tests for the score-only behavioural overlay used by the Attendance Scorecard
 * (Apr–Jun 2026 backfill). The overlay must move the actual late-comings /
 * missing punches / early departures onto the corrected days for scoring —
 * WITHOUT ever changing presence (status).
 */
import { describe, it, expect } from "vitest";
import { overlayScoreSignals } from "@/lib/hr-attendance-score-data";

type AttDay = {
  id: string;
  employeeId: string;
  date: Date;
  status: string;
  inTime: string | null;
  outTime: string | null;
  lateMinutes: number | null;
  earlyOutMinutes: number | null;
};

const D = (day: number) => new Date(Date.UTC(2026, 3, day)); // April 2026
const key = (employeeId: string, date: Date) => `${employeeId}|${date.toISOString().slice(0, 10)}`;

const day = (over: Partial<AttDay> = {}): AttDay => ({
  id: "d",
  employeeId: "e1",
  date: D(6),
  status: "P",
  inTime: "09:00",
  outTime: "17:30",
  lateMinutes: 0,
  earlyOutMinutes: 0,
  ...over,
});

describe("overlayScoreSignals", () => {
  it("returns the same days untouched when there are no signals", () => {
    const days = [day()];
    expect(overlayScoreSignals(days, new Map())).toBe(days);
  });

  it("replaces behavioural fields on a WORKED day but preserves presence status", () => {
    const d = day({ status: "P", inTime: "09:00", outTime: "17:30", lateMinutes: 0, earlyOutMinutes: 0 });
    const sig = new Map([[key("e1", D(6)), { inTime: "09:22", outTime: "16:40", lateMinutes: 22, earlyOutMinutes: 50 }]]);
    const [out] = overlayScoreSignals([d], sig);
    expect(out.status).toBe("P"); // presence untouched
    expect(out.lateMinutes).toBe(22);
    expect(out.inTime).toBe("09:22");
    expect(out.outTime).toBe("16:40");
    expect(out.earlyOutMinutes).toBe(50);
    expect(out.id).toBe(d.id); // identity/date preserved
    expect(out.date).toBe(d.date);
  });

  it("applies to half-day (HD) rows too — they are worked days", () => {
    const d = day({ status: "HD", lateMinutes: 0 });
    const sig = new Map([[key("e1", D(6)), { inTime: "09:40", outTime: null, lateMinutes: 40, earlyOutMinutes: 0 }]]);
    const [out] = overlayScoreSignals([d], sig);
    expect(out.status).toBe("HD");
    expect(out.lateMinutes).toBe(40);
  });

  it("does NOT overlay a NON-worked day (LV/A/WO/HL) — a stray raw punch is ignored", () => {
    for (const status of ["LV", "A", "WO", "HL"]) {
      const d = day({ status, inTime: null, outTime: null, lateMinutes: null, earlyOutMinutes: null });
      const sig = new Map([[key("e1", D(6)), { inTime: "09:15", outTime: null, lateMinutes: 15, earlyOutMinutes: 0 }]]);
      const [out] = overlayScoreSignals([d], sig);
      expect(out.status).toBe(status);
      expect(out.inTime).toBeNull(); // no punch introduced → no false missing-punch
      expect(out.outTime).toBeNull();
      expect(out.lateMinutes).toBeNull();
    }
  });

  it("leaves a worked day with no matching signal unchanged (live cycles unaffected)", () => {
    const d = day({ status: "P", inTime: "09:05", outTime: "17:31", lateMinutes: 5 });
    const sig = new Map([[key("e1", D(7)), { inTime: "10:00", outTime: "17:00", lateMinutes: 60, earlyOutMinutes: 0 }]]);
    const [out] = overlayScoreSignals([d], sig); // signal is for a different date
    expect(out).toEqual(d);
  });

  it("surfaces a raw missing punch (one-sided) onto a corrected full day", () => {
    // Corrected DB filled both punches; raw had only an in-punch → the overlay
    // restores the one-sided punch so Discipline sees the missing punch.
    const d = day({ status: "P", inTime: "09:02", outTime: "17:33" });
    const sig = new Map([[key("e1", D(6)), { inTime: "09:07", outTime: null, lateMinutes: 7, earlyOutMinutes: 0 }]]);
    const [out] = overlayScoreSignals([d], sig);
    expect(out.inTime).toBe("09:07");
    expect(out.outTime).toBeNull();
    expect(!!out.inTime !== !!out.outTime).toBe(true); // exactly one punch → missing-punch incident
  });

  it("does not mutate the input day objects", () => {
    const d = day({ status: "P", lateMinutes: 0 });
    const sig = new Map([[key("e1", D(6)), { inTime: "09:30", outTime: "17:30", lateMinutes: 30, earlyOutMinutes: 0 }]]);
    overlayScoreSignals([d], sig);
    expect(d.lateMinutes).toBe(0); // original untouched
    expect(d.inTime).toBe("09:00");
  });
});
