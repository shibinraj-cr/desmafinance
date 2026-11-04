import { describe, it, expect } from "vitest";

// crm-monthly-comparison is pure — no prisma import, so no module mock is needed.
import {
  buildMonthlyComparison,
  cellConversion,
  comparisonMonths,
  monthsEnding,
  NO_SOURCE_ID,
  type LeadFact,
  type SaleFact,
} from "@/lib/crm-monthly-comparison";

const MONTHS = ["2026-09", "2026-10", "2026-11"];
const roster = [
  { userId: "a", name: "Alpha", role: "l2" },
  { userId: "b", name: "Bravo", role: "l1" },
];
const sources = [
  { id: "meta", label: "Meta", active: true },
  { id: "web", label: "Website", active: true },
  { id: "old", label: "Old fair", active: false },
];

function build(leads: LeadFact[], sales: SaleFact[], otherNames = new Map<string, string>()) {
  return buildMonthlyComparison({ months: MONTHS, leads, sales, roster, otherNames, sources });
}

describe("monthsEnding", () => {
  it("walks back across a year boundary, oldest first", () => {
    expect(monthsEnding(2027, 2, 4).map((m) => m.value)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("comparisonMonths", () => {
  it("adds the year only when the window spans two, and flags the current month as partial", () => {
    const same = comparisonMonths(monthsEnding(2026, 11, 2), "2026-11");
    expect(same.map((m) => m.short)).toEqual(["Oct", "Nov"]);
    expect(same.map((m) => m.partial)).toEqual([false, true]);
    const spanning = comparisonMonths(monthsEnding(2027, 1, 2), "2027-03");
    expect(spanning.map((m) => m.short)).toEqual(["Dec ’26", "Jan ’27"]);
    expect(spanning.every((m) => !m.partial)).toBe(true);
  });
});

describe("buildMonthlyComparison", () => {
  it("buckets leads and sales into the right BDE × month and source × month cells", () => {
    const { byBde, bySource } = build(
      [
        { userId: "a", sourceId: "meta", month: "2026-09", count: 10 },
        { userId: "a", sourceId: "web", month: "2026-10", count: 4 },
        { userId: "b", sourceId: "meta", month: "2026-11", count: 6 },
      ],
      [
        { userId: "a", sourceId: "meta", month: "2026-10", value: 50_000 },
        { userId: "a", sourceId: "meta", month: "2026-10", value: 25_000 },
        { userId: "b", sourceId: "web", month: "2026-11", value: 40_000 },
      ],
    );
    const alpha = byBde.rows.find((r) => r.id === "a")!;
    expect(alpha.cells.map((c) => c.leads)).toEqual([10, 4, 0]);
    expect(alpha.cells.map((c) => c.enrolled)).toEqual([0, 2, 0]);
    expect(alpha.total).toEqual({ leads: 14, enrolled: 2, value: 75_000 });

    const meta = bySource.rows.find((r) => r.id === "meta")!;
    expect(meta.cells.map((c) => c.leads)).toEqual([10, 0, 6]);
    expect(meta.cells.map((c) => c.value)).toEqual([0, 75_000, 0]);
  });

  it("keeps both tables' team totals equal — every fact lands in one row of each", () => {
    const { byBde, bySource } = build(
      [
        { userId: "a", sourceId: "meta", month: "2026-09", count: 3 },
        { userId: "gone", sourceId: null, month: "2026-10", count: 2 },
      ],
      [
        { userId: "gone", sourceId: "old", month: "2026-09", value: 10_000 },
        { userId: "b", sourceId: "web", month: "2026-11", value: 20_000 },
      ],
    );
    expect(byBde.totals).toEqual(bySource.totals);
    expect(byBde.grandTotal).toEqual({ leads: 5, enrolled: 2, value: 30_000 });
  });

  it("shows every roster BDE even at zero, then a leaver with activity after them", () => {
    const { byBde } = build([], [{ userId: "gone", sourceId: "meta", month: "2026-09", value: 1 }], new Map([["gone", "Former BDE"]]));
    expect(byBde.rows.map((r) => r.id)).toEqual(["a", "b", "gone"]);
    const gone = byBde.rows[2];
    expect(gone).toMatchObject({ name: "Former BDE", note: "not on roster", clickable: false });
    expect(byBde.rows[0]).toMatchObject({ note: "L2", clickable: true });
  });

  it("orders roster rows by enrolments, then value", () => {
    const { byBde } = build([], [
      { userId: "b", sourceId: "meta", month: "2026-10", value: 1 },
      { userId: "b", sourceId: "meta", month: "2026-11", value: 1 },
      { userId: "a", sourceId: "meta", month: "2026-11", value: 5 },
    ]);
    expect(byBde.rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("keeps sourceless leads and inactive sources, drops sources with no activity", () => {
    const { bySource } = build(
      [{ userId: "a", sourceId: null, month: "2026-10", count: 7 }],
      [{ userId: "a", sourceId: "old", month: "2026-10", value: 1 }],
    );
    expect(bySource.rows.map((r) => r.id).sort()).toEqual([NO_SOURCE_ID, "old"].sort());
    expect(bySource.rows.find((r) => r.id === NO_SOURCE_ID)!.name).toBe("No source");
    expect(bySource.rows.find((r) => r.id === "old")!.note).toBe("inactive");
  });

  it("ignores facts outside the window", () => {
    const { byBde } = build([{ userId: "a", sourceId: "meta", month: "2026-08", count: 99 }], []);
    expect(byBde.grandTotal.leads).toBe(0);
  });
});

describe("cellConversion", () => {
  it("is enrolled over leads to 1 dp, null with no leads", () => {
    expect(cellConversion({ leads: 30, enrolled: 2, value: 0 })).toBe(6.7);
    expect(cellConversion({ leads: 0, enrolled: 1, value: 0 })).toBeNull();
  });
});
