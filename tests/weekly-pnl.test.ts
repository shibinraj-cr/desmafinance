import { describe, expect, it } from "vitest";
import { buildWeeklyPnl, weekChange, weekStart, type LedgerRow } from "@/lib/weekly-pnl";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

function row(date: string, type: string, category: string, amount: number): LedgerRow {
  return { date: d(date), type, category, amount };
}

describe("weekStart", () => {
  it("returns the Saturday on or before the date", () => {
    expect(iso(weekStart(d("2026-10-03")))).toBe("2026-10-03"); // Saturday
    expect(iso(weekStart(d("2026-10-09")))).toBe("2026-10-03"); // Friday
    expect(iso(weekStart(d("2026-10-02")))).toBe("2026-09-26"); // Friday before
    expect(iso(weekStart(d("2026-04-01")))).toBe("2026-03-28"); // Wednesday
  });
});

describe("buildWeeklyPnl", () => {
  it("reports sales net of GST, keeps GST paid out of profit, and still reconciles cash", () => {
    const pnl = buildWeeklyPnl({
      fy: 2026,
      today: d("2026-04-10"),
      rows: [
        { ...row("2026-04-04", "Revenue", "Sales - Nursing Registrations", 118_000), gstAmount: 18_000 },
        row("2026-04-05", "Revenue", "Collection - Study Abroad", 50_000), // export: no GST
        row("2026-04-06", "Expense", "Rent", 20_000),
        { ...row("2026-04-07", "Expense", "Taxes", 18_000), subItem: "GST" },
        row("2026-04-08", "Expense", "Loan Repayment", 10_000),
      ],
    });
    const w = pnl.weeks[0];
    expect(w.sales).toBe(100_000);
    expect(w.netSales).toBe(150_000);
    expect(w.operatingExpense).toBe(20_000); // GST paid isn't a cost
    expect(w.netProfit).toBe(130_000);
    expect(w.gstCollected).toBe(18_000);
    expect(w.gstPaid).toBe(18_000);
    // All money in (168,000) − all money out (48,000).
    expect(w.netCashFlow).toBe(120_000);
  });


  it("clips the first week to 1 April and flags it partial", () => {
    const pnl = buildWeeklyPnl({ fy: 2026, rows: [], today: d("2026-04-10") });
    const oldest = pnl.weeks[pnl.weeks.length - 1];
    expect(iso(oldest.from)).toBe("2026-04-01");
    expect(iso(oldest.to)).toBe("2026-04-03");
    expect(oldest.partial).toBe(true);
    // 4–10 Apr is the running week, Sat → Fri, not partial.
    expect(iso(pnl.weeks[0].from)).toBe("2026-04-04");
    expect(iso(pnl.weeks[0].to)).toBe("2026-04-10");
    expect(pnl.weeks[0].partial).toBe(false);
    expect(pnl.weeks[0].running).toBe(true);
  });

  it("classifies rows and reconciles the three nets", () => {
    const pnl = buildWeeklyPnl({
      fy: 2026,
      today: d("2026-04-10"),
      rows: [
        row("2026-04-04", "Revenue", "Sales - Nursing Registrations", 100_000),
        row("2026-04-05", "Revenue", "Collection - Study Abroad", 50_000),
        row("2026-04-06", "Revenue", "Commissions", 10_000),
        row("2026-04-06", "Expense", "Refund", 20_000),
        row("2026-04-07", "Expense", "Salary", 60_000),
        row("2026-04-07", "Expense", "Marketing", 15_000),
        row("2026-04-08", "Expense", "Buying Assets", 30_000),
        row("2026-04-09", "Expense", "Loan Repayment", 5_000),
      ],
    });
    const w = pnl.weeks[0];
    expect(w.sales).toBe(100_000);
    expect(w.collections).toBe(50_000);
    expect(w.otherIncome).toBe(10_000);
    expect(w.refunds).toBe(20_000);
    expect(w.netSales).toBe(140_000);
    expect(w.operatingExpense).toBe(75_000);
    expect(w.netProfit).toBe(65_000);
    expect(w.nonOperating).toBe(35_000);
    expect(w.netCashFlow).toBe(30_000);
    // Net cash flow is plain revenue − expense, like the Cash Flow page.
    expect(w.netCashFlow).toBe(160_000 - 130_000);
    expect(w.marginPct).toBe(46.43);
  });

  it("puts Friday in the week and Saturday in the next", () => {
    const pnl = buildWeeklyPnl({
      fy: 2026,
      today: d("2026-04-20"),
      rows: [
        row("2026-04-10", "Revenue", "Commissions", 1), // Fri
        row("2026-04-11", "Revenue", "Commissions", 2), // Sat
      ],
    });
    const byFrom = new Map(pnl.weeks.map((w) => [iso(w.from), w.netSales]));
    expect(byFrom.get("2026-04-04")).toBe(1);
    expect(byFrom.get("2026-04-11")).toBe(2);
  });

  it("sums weeks to the FY total and ignores rows outside the FY", () => {
    const pnl = buildWeeklyPnl({
      fy: 2026,
      today: d("2026-04-20"),
      rows: [
        row("2026-03-31", "Revenue", "Commissions", 999), // prior FY
        row("2026-04-02", "Revenue", "Commissions", 10),
        row("2026-04-15", "Expense", "Rent", 4),
      ],
    });
    expect(pnl.total.netSales).toBe(10);
    expect(pnl.total.netCashFlow).toBe(6);
    expect(pnl.weeks.reduce((s, w) => s + w.netCashFlow, 0)).toBe(pnl.total.netCashFlow);
  });

  it("picks the last two closed weeks and the running one", () => {
    const pnl = buildWeeklyPnl({ fy: 2026, rows: [], today: d("2026-10-03") });
    expect(iso(pnl.running!.from)).toBe("2026-10-03");
    expect(iso(pnl.lastClosed!.from)).toBe("2026-09-26");
    expect(iso(pnl.lastClosed!.to)).toBe("2026-10-02");
    expect(iso(pnl.priorClosed!.from)).toBe("2026-09-19");
  });

  it("ends a finished year at 31 March with no running week", () => {
    const pnl = buildWeeklyPnl({ fy: 2026, rows: [], today: d("2027-06-01") });
    expect(pnl.running).toBeNull();
    expect(iso(pnl.weeks[0].to)).toBe("2027-03-31");
    expect(pnl.weeks[0].partial).toBe(true);
    expect(pnl.lastClosed).toBe(pnl.weeks[0]);
  });

  it("returns no weeks for a year that hasn't started", () => {
    const pnl = buildWeeklyPnl({ fy: 2027, rows: [], today: d("2026-10-03") });
    expect(pnl.weeks).toHaveLength(0);
    expect(pnl.lastClosed).toBeNull();
  });
});

describe("weekChange", () => {
  it("measures against the size of the earlier figure", () => {
    expect(weekChange(150, 100)).toBe(50);
    expect(weekChange(-50, -100)).toBe(50); // loss halved = improvement
    expect(weekChange(10, 0)).toBeNull();
    expect(weekChange(10, null)).toBeNull();
  });
});
