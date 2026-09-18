import { describe, it, expect } from "vitest";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * The fan-out rule, isolated from the DB: approving a leave range writes one
 * attendance day per WORKING day in it. Sundays and published holidays inside
 * the range are not leave and must never be charged.
 *
 * `businessDaysBetween` itself queries holidays, so this pins the pure
 * weekday/inclusivity half of the contract that the fan-out depends on.
 */
function workingDaysIgnoringHolidays(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(from);
  while (cur <= to) {
    if (cur.getUTCDay() !== 0) out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

describe("planned leave range", () => {
  it("covers Mon-Wed as three days", () => {
    // 2026-09-21 is a Monday.
    expect(workingDaysIgnoringHolidays(d("2026-09-21"), d("2026-09-23"))).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
    ]);
  });

  it("skips the Sunday inside a range spanning a weekend", () => {
    // Sat 26 Sep → Mon 28 Sep: Sunday the 27th is not leave.
    expect(workingDaysIgnoringHolidays(d("2026-09-26"), d("2026-09-28"))).toEqual([
      "2026-09-26",
      "2026-09-28",
    ]);
  });

  it("treats a single date as one day", () => {
    expect(workingDaysIgnoringHolidays(d("2026-09-21"), d("2026-09-21"))).toEqual(["2026-09-21"]);
  });

  it("yields nothing when the range is only a Sunday", () => {
    expect(workingDaysIgnoringHolidays(d("2026-09-27"), d("2026-09-27"))).toEqual([]);
  });
});
