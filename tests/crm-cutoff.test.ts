import { describe, it, expect } from "vitest";
import { cutoffOn, nextCutoff } from "@/lib/crm-cutoff";

// 2026-11-09 is a Monday; 11-14 Saturday, 11-15 Sunday.
const ist = (dateTime: string) => new Date(`${dateTime.replace(" ", "T")}:00+05:30`);
const none = new Set<string>();

describe("cutoffOn", () => {
  it("is 17:00 IST on weekdays and 15:30 IST on Saturday", () => {
    expect(cutoffOn("2026-11-09", none)).toEqual(ist("2026-11-09 17:00"));
    expect(cutoffOn("2026-11-13", none)).toEqual(ist("2026-11-13 17:00"));
    expect(cutoffOn("2026-11-14", none)).toEqual(ist("2026-11-14 15:30"));
  });

  it("has no cutoff on Sunday or a holiday", () => {
    expect(cutoffOn("2026-11-15", none)).toBeNull();
    expect(cutoffOn("2026-11-09", new Set(["2026-11-09"]))).toBeNull();
  });

  it("is the right UTC instant", () => {
    expect(cutoffOn("2026-11-09", none)!.toISOString()).toBe("2026-11-09T11:30:00.000Z");
    expect(cutoffOn("2026-11-14", none)!.toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });
});

describe("nextCutoff — the brief's acceptance cases", () => {
  it("Mon 10:00 → Mon 17:00", () => {
    expect(nextCutoff(ist("2026-11-09 10:00"), none)).toEqual(ist("2026-11-09 17:00"));
  });

  it("Mon 17:30 → Tue 17:00", () => {
    expect(nextCutoff(ist("2026-11-09 17:30"), none)).toEqual(ist("2026-11-10 17:00"));
  });

  it("Fri 18:00 → Sat 15:30", () => {
    expect(nextCutoff(ist("2026-11-13 18:00"), none)).toEqual(ist("2026-11-14 15:30"));
  });

  it("Sat 16:00 → Mon 17:00", () => {
    expect(nextCutoff(ist("2026-11-14 16:00"), none)).toEqual(ist("2026-11-16 17:00"));
  });

  it("Sunday at any time → Mon 17:00", () => {
    for (const t of ["00:00", "09:30", "16:59", "23:59"]) {
      expect(nextCutoff(ist(`2026-11-15 ${t}`), none)).toEqual(ist("2026-11-16 17:00"));
    }
  });

  it("the day before a holiday, after cutoff → the next working day", () => {
    const holidays = new Set(["2026-11-18"]); // Wednesday
    expect(nextCutoff(ist("2026-11-17 18:00"), holidays)).toEqual(ist("2026-11-19 17:00"));
  });
});

describe("nextCutoff — edges", () => {
  it("16:59 is still due the same day", () => {
    expect(nextCutoff(ist("2026-11-09 16:59"), none)).toEqual(ist("2026-11-09 17:00"));
  });

  it("exactly at the cutoff counts as after it", () => {
    expect(nextCutoff(ist("2026-11-09 17:00"), none)).toEqual(ist("2026-11-10 17:00"));
    expect(nextCutoff(ist("2026-11-14 15:30"), none)).toEqual(ist("2026-11-16 17:00"));
  });

  it("Saturday before 15:30 is due Saturday", () => {
    expect(nextCutoff(ist("2026-11-14 15:29"), none)).toEqual(ist("2026-11-14 15:30"));
  });

  it("assigned on a holiday → next working day", () => {
    const holidays = new Set(["2026-11-09"]);
    expect(nextCutoff(ist("2026-11-09 10:00"), holidays)).toEqual(ist("2026-11-10 17:00"));
  });

  it("skips a run of holidays", () => {
    const holidays = new Set(["2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(nextCutoff(ist("2026-11-14 16:00"), holidays)).toEqual(ist("2026-11-19 17:00"));
  });

  it("a Saturday holiday moves Friday-evening work to Monday", () => {
    const holidays = new Set(["2026-11-14"]);
    expect(nextCutoff(ist("2026-11-13 18:00"), holidays)).toEqual(ist("2026-11-16 17:00"));
  });

  it("a Monday holiday moves Saturday-evening work to Tuesday", () => {
    const holidays = new Set(["2026-11-16"]);
    expect(nextCutoff(ist("2026-11-14 16:00"), holidays)).toEqual(ist("2026-11-17 17:00"));
  });

  it("uses the IST day, not the UTC day, around midnight", () => {
    // Mon 00:10 IST is still Sunday in UTC.
    expect(nextCutoff(ist("2026-11-16 00:10"), none)).toEqual(ist("2026-11-16 17:00"));
    // Sat 23:00 IST is still Saturday in UTC, but past the cutoff.
    expect(nextCutoff(ist("2026-11-14 23:00"), none)).toEqual(ist("2026-11-16 17:00"));
    // Sun 05:00 IST is Saturday 23:30 in UTC — still no Saturday cutoff to meet.
    expect(nextCutoff(ist("2026-11-15 05:00"), none)).toEqual(ist("2026-11-16 17:00"));
  });

  it("ignores the calendar rather than failing when it has no working day for months", () => {
    const holidays = new Set<string>();
    for (let d = new Date("2026-11-10T00:00:00Z"); d < new Date("2027-03-01T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      holidays.add(d.toISOString().slice(0, 10));
    }
    expect(nextCutoff(ist("2026-11-09 18:00"), holidays)).toEqual(ist("2026-11-10 17:00"));
  });
});
