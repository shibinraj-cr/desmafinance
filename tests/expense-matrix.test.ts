/**
 * The Expense Matrix's rules all live in two pure functions — the fiscal-year
 * maths and the grid builder — so they are tested without a database. The
 * Prisma read they sit behind is a `findMany` with no shaping of its own.
 */
import { describe, it, expect } from "vitest";

import {
  LEDGER_FIRST_FY,
  currentFy,
  fyEnd,
  fyForDate,
  fyLabel,
  fyMonthIndex,
  fyMonthLabels,
  fyMonthStart,
  fyStart,
  parseFy,
  postedMonthCount,
  selectableFys,
} from "@/lib/fiscal-year";
import {
  OTHER_ROW,
  buildExpenseMatrix,
  changeOn,
  matrixHighlights,
  matrixToCsv,
  type ExpenseCell,
} from "@/lib/expense-matrix";

// 14 Sep 2026, 09:00 IST — six months into FY 2026-27.
const SEP_2026 = new Date("2026-09-14T03:30:00.000Z");

describe("fiscal-year maths", () => {
  it("runs April to March", () => {
    expect(fyStart(2026).toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(fyEnd(2026).toISOString()).toBe("2027-04-01T00:00:00.000Z");
    expect(fyLabel(2026)).toBe("FY 2026-27");
  });

  it("puts January through March in the year that opened the previous April", () => {
    expect(fyForDate(new Date("2027-02-15T00:00:00Z"))).toBe(2026);
    expect(fyForDate(new Date("2026-04-01T00:00:00Z"))).toBe(2026);
    expect(fyForDate(new Date("2026-03-31T00:00:00Z"))).toBe(2025);
  });

  it("indexes months from April", () => {
    expect(fyMonthIndex(new Date("2026-04-10T00:00:00Z"))).toBe(0);
    expect(fyMonthIndex(new Date("2026-09-30T00:00:00Z"))).toBe(5);
    expect(fyMonthIndex(new Date("2027-03-01T00:00:00Z"))).toBe(11);
  });

  it("labels months the way Transaction.month does", () => {
    const labels = fyMonthLabels(2026);
    expect(labels[0]).toBe("Apr-26");
    expect(labels[8]).toBe("Dec-26");
    expect(labels[9]).toBe("Jan-27");
    expect(labels[11]).toBe("Mar-27");
  });

  it("starts each fiscal month on the first", () => {
    expect(fyMonthStart(2026, 0).toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(fyMonthStart(2026, 9).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(fyMonthStart(2026, 11).toISOString()).toBe("2027-03-01T00:00:00.000Z");
  });

  it("counts a month as posted the moment it begins", () => {
    expect(postedMonthCount(2026, SEP_2026)).toBe(6); // Apr–Sep, Sep still running
    expect(postedMonthCount(2025, SEP_2026)).toBe(12); // a finished year
    expect(postedMonthCount(2027, SEP_2026)).toBe(0); // not started
  });

  it("reads the month off the IST calendar, not the server's UTC clock", () => {
    // 1 Oct 2026, 02:00 IST is still 30 Sep in UTC. The office is in October.
    const earlyOctIst = new Date("2026-09-30T20:30:00.000Z");
    expect(postedMonthCount(2026, earlyOctIst)).toBe(7);
    expect(currentFy(earlyOctIst)).toBe(2026);
  });

  it("never offers a year below the first the ledger covers", () => {
    expect(selectableFys(SEP_2026)).toEqual([2026]);
    expect(selectableFys(new Date("2028-06-01T00:00:00Z"))).toEqual([2028, 2027, 2026]);
    expect(Math.min(...selectableFys(SEP_2026))).toBe(LEDGER_FIRST_FY);
  });

  it("falls back to the running year for junk or out-of-range ?fy=", () => {
    expect(parseFy("2026", SEP_2026)).toBe(2026);
    expect(parseFy("1999", SEP_2026)).toBe(2026);
    expect(parseFy("banana", SEP_2026)).toBe(2026);
    expect(parseFy(undefined, SEP_2026)).toBe(2026);
  });
});

/** Cells for one category across the months given, in rupees. */
function cells(category: string, amounts: Record<number, number>): ExpenseCell[] {
  return Object.entries(amounts).map(([monthIndex, amount]) => ({
    category,
    monthIndex: Number(monthIndex),
    amount,
  }));
}

describe("buildExpenseMatrix", () => {
  const current = [
    ...cells("Salary", { 0: 695_000, 1: 740_000, 5: 885_000 }),
    ...cells("Marketing", { 0: 310_000, 2: 420_000 }),
    ...cells("Taxes", { 2: 785_000 }),
  ];
  const prior = [
    ...cells("Salary", { 0: 540_000, 1: 545_000, 5: 595_000, 11: 675_000 }),
    ...cells("Marketing", { 0: 210_000, 2: 260_000 }),
    ...cells("Taxes", { 2: 910_000 }),
  ];

  it("blanks months that have not begun instead of showing them as zero", () => {
    const m = buildExpenseMatrix({ fy: 2026, current, prior: null, postedMonths: 6 });
    const salary = m.rows.find((r) => r.name === "Salary")!;
    expect(salary.months.slice(0, 6)).toEqual([695_000, 740_000, 0, 0, 0, 885_000]);
    expect(salary.months.slice(6)).toEqual([null, null, null, null, null, null]);
    expect(m.monthTotals[6]).toBeNull();
  });

  it("totals only the posted months", () => {
    const m = buildExpenseMatrix({ fy: 2026, current, prior: null, postedMonths: 6 });
    expect(m.total).toBe(3_835_000);
    expect(m.rows.find((r) => r.name === "Salary")!.total).toBe(2_320_000);
  });

  it("compares like-for-like — the prior year is cut to the same months", () => {
    const m = buildExpenseMatrix({ fy: 2026, current, prior, postedMonths: 6 });
    const salary = m.rows.find((r) => r.name === "Salary")!;
    // Last year's March (₹6.75L) is real, and is in priorMonths…
    expect(salary.priorMonths![11]).toBe(675_000);
    // …but must not count against a year that has only reached September.
    expect(salary.priorTotal).toBe(1_680_000);
    expect(salary.changePct).toBeCloseTo(38.1, 1);
  });

  it("ranks heaviest first but pins the folded row to the bottom", () => {
    const many = [
      ...cells("A", { 0: 900 }),
      ...cells("B", { 0: 800 }),
      ...cells("C", { 0: 700 }),
      ...cells("D", { 0: 600 }),
      ...cells("E", { 0: 500 }),
    ];
    const m = buildExpenseMatrix({ fy: 2026, current: many, prior: null, postedMonths: 1, topN: 2 });
    expect(m.rows.map((r) => r.name)).toEqual(["A", "B", OTHER_ROW]);
    expect(m.rows[2].total).toBe(1800); // C + D + E
    expect(m.rows[2].isOther).toBe(true);
    // The fold is a bucket, not a lost total.
    expect(m.total).toBe(3500);
    expect(m.categoryCount).toBe(5);
  });

  it("folds a category that only last year had, rather than giving it a lonely row", () => {
    const m = buildExpenseMatrix({
      fy: 2026,
      current: cells("Salary", { 0: 100 }),
      prior: [...cells("Salary", { 0: 80 }), ...cells("Retired line", { 0: 50 })],
      postedMonths: 1,
      topN: 8,
    });
    expect(m.rows.map((r) => r.name)).toEqual(["Salary", OTHER_ROW]);
    expect(m.rows[1].priorTotal).toBe(50);
    expect(m.rows[1].total).toBe(0);
  });

  it("reports no comparison at all when the prior year is empty", () => {
    const m = buildExpenseMatrix({ fy: 2026, current, prior: [], postedMonths: 6 });
    expect(m.hasPrior).toBe(false);
    expect(m.priorTotal).toBeNull();
    expect(m.changePct).toBeNull();
    expect(m.rows.every((r) => r.priorMonths === null)).toBe(true);
  });

  it("survives a year with nothing posted yet", () => {
    const m = buildExpenseMatrix({ fy: 2027, current: [], prior: null, postedMonths: 0 });
    expect(m.rows).toEqual([]);
    expect(m.total).toBe(0);
    expect(m.monthTotals.every((v) => v === null)).toBe(true);
  });

  it("column totals and row totals agree with the grand total", () => {
    const m = buildExpenseMatrix({ fy: 2026, current, prior, postedMonths: 6 });
    const byColumn = m.monthTotals.reduce<number>((s, v) => s + (v ?? 0), 0);
    const byRow = m.rows.reduce((s, r) => s + r.total, 0);
    expect(byColumn).toBe(m.total);
    expect(byRow).toBe(m.total);
  });
});

describe("changeOn", () => {
  it("refuses to divide by a year that spent nothing", () => {
    expect(changeOn(100, 0)).toBeNull();
    expect(changeOn(100, null)).toBeNull();
  });

  it("signs the change the way arithmetic does — the UI decides if it is good news", () => {
    expect(changeOn(150, 100)).toBe(50);
    expect(changeOn(50, 100)).toBe(-50);
  });
});

describe("matrixHighlights", () => {
  const current = [
    ...cells("Salary", { 0: 100, 1: 100, 2: 100 }),
    ...cells("Taxes", { 2: 900 }),
  ];

  it("names the heaviest month and what drove it", () => {
    const m = buildExpenseMatrix({ fy: 2026, current, prior: null, postedMonths: 3 });
    const { peak } = matrixHighlights(m);
    expect(peak).toEqual({ monthIndex: 2, amount: 1000, leader: "Taxes" });
  });

  it("ranks growth only among categories with a comparable year", () => {
    const m = buildExpenseMatrix({
      fy: 2026,
      current,
      prior: [...cells("Salary", { 0: 100 }), ...cells("Taxes", { 2: 800 })],
      postedMonths: 3,
    });
    const { mover } = matrixHighlights(m);
    expect(mover!.name).toBe("Salary"); // 300 vs 100 beats 900 vs 800
    expect(mover!.changePct).toBe(200);
  });

  it("has nothing to say about an empty year", () => {
    const m = buildExpenseMatrix({ fy: 2027, current: [], prior: null, postedMonths: 0 });
    expect(matrixHighlights(m)).toEqual({ peak: null, mover: null });
  });
});

describe("matrixToCsv", () => {
  const matrix = buildExpenseMatrix({
    fy: 2026,
    current: [...cells("Salary", { 0: 100, 1: 200 }), ...cells("Taxes, duties", { 0: 50 })],
    prior: [...cells("Salary", { 0: 80, 1: 90 }), ...cells("Taxes, duties", { 0: 40 })],
    postedMonths: 2,
  });
  const csv = matrixToCsv({
    matrix,
    fyName: "FY 2026-27",
    priorFyName: "FY 2025-26",
    monthLabels: fyMonthLabels(2026),
  });
  const lines = csv.split("\n");

  it("heads the columns with the months the grid shows", () => {
    expect(lines[0].startsWith("Category,Apr-26,May-26,")).toBe(true);
    expect(lines[0].endsWith("FY 2026-27 to date,FY 2025-26 same period,Change %")).toBe(true);
  });

  it("exports whole rupees, not the lakh on screen", () => {
    expect(lines[1].startsWith("Salary,100,200,")).toBe(true);
  });

  it("leaves months that have not begun empty so a spreadsheet sum still ties", () => {
    const salary = lines[1].split(",");
    expect(salary.slice(3, 13).every((c) => c === "")).toBe(true);
    expect(salary[13]).toBe("300"); // FY to date
  });

  it("quotes a category containing a comma", () => {
    expect(csv).toContain('"Taxes, duties"');
  });

  it("ends on a total row that matches the grid", () => {
    const total = lines[lines.length - 1].split(",");
    expect(total[0]).toBe("Total");
    expect(total[13]).toBe(String(matrix.total));
  });

  it("drops the comparison columns entirely when there is no prior year", () => {
    const solo = buildExpenseMatrix({
      fy: 2026,
      current: cells("Salary", { 0: 100 }),
      prior: null,
      postedMonths: 1,
    });
    const head = matrixToCsv({
      matrix: solo,
      fyName: "FY 2026-27",
      priorFyName: "FY 2025-26",
      monthLabels: fyMonthLabels(2026),
    }).split("\n")[0];
    expect(head.endsWith("FY 2026-27 to date")).toBe(true);
    expect(head).not.toContain("Change %");
  });
});
