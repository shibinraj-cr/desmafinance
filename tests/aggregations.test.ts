/**
 * Aggregations.ts is mostly thin wrappers over Prisma groupBy/aggregate calls,
 * so the meaningful logic to test is the helper that converts Prisma's
 * Decimal output to a JS number, plus the month-bucket merging shape.
 *
 * We mock the Prisma client to avoid touching a real database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  totalsByType,
  monthlySeries,
  expenseBreakdown,
  topRevenueServices,
  paymentModeMix,
} from "@/lib/aggregations";

const mockedGroupBy = prisma.transaction.groupBy as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedGroupBy.mockReset();
});

describe("totalsByType", () => {
  it("sums revenue and expense and computes net", async () => {
    mockedGroupBy.mockResolvedValueOnce([
      { type: "Revenue", _sum: { amount: { toString: () => "1000.50" } } },
      { type: "Expense", _sum: { amount: { toString: () => "400.25" } } },
    ]);
    const t = await totalsByType();
    expect(t.revenue).toBe(1000.5);
    expect(t.expense).toBe(400.25);
    expect(t.net).toBeCloseTo(600.25, 2);
  });

  it("returns zeros when there are no rows", async () => {
    mockedGroupBy.mockResolvedValueOnce([]);
    expect(await totalsByType()).toEqual({ revenue: 0, expense: 0, net: 0 });
  });

  it("only counts non-deleted rows (deletedAt: null is in the where clause)", async () => {
    mockedGroupBy.mockResolvedValueOnce([]);
    await totalsByType();
    const callArg = mockedGroupBy.mock.calls[0][0];
    expect(callArg.where).toMatchObject({ deletedAt: null });
  });
});

describe("monthlySeries", () => {
  it("returns 12 buckets in fiscal-year order even when most months have no rows", async () => {
    mockedGroupBy.mockResolvedValueOnce([
      { month: "Apr-26", type: "Revenue", _sum: { amount: { toString: () => "100" } } },
      { month: "Apr-26", type: "Expense", _sum: { amount: { toString: () => "30" } } },
      { month: "Jul-26", type: "Revenue", _sum: { amount: { toString: () => "200" } } },
    ]);
    const s = await monthlySeries();
    expect(s).toHaveLength(12);
    expect(s.map((b) => b.month)).toEqual([
      "Apr-26",
      "May-26",
      "Jun-26",
      "Jul-26",
      "Aug-26",
      "Sep-26",
      "Oct-26",
      "Nov-26",
      "Dec-26",
      "Jan-27",
      "Feb-27",
      "Mar-27",
    ]);
    const apr = s.find((b) => b.month === "Apr-26")!;
    expect(apr).toEqual({ month: "Apr-26", revenue: 100, expense: 30, net: 70 });
    const may = s.find((b) => b.month === "May-26")!;
    expect(may).toEqual({ month: "May-26", revenue: 0, expense: 0, net: 0 });
    const jul = s.find((b) => b.month === "Jul-26")!;
    expect(jul).toEqual({ month: "Jul-26", revenue: 200, expense: 0, net: 200 });
  });
});

describe("expenseBreakdown / topRevenueServices", () => {
  it("returns sorted descending by value and respects limit", async () => {
    mockedGroupBy.mockResolvedValueOnce([
      { category: "Marketing", _sum: { amount: { toString: () => "5000" } } },
      { category: "Salary", _sum: { amount: { toString: () => "20000" } } },
      { category: "Rent", _sum: { amount: { toString: () => "10000" } } },
    ]);
    const r = await expenseBreakdown(2);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ name: "Salary", value: 20000 });
    expect(r[1]).toEqual({ name: "Rent", value: 10000 });
  });

  it("only counts non-deleted Revenue rows for top services", async () => {
    mockedGroupBy.mockResolvedValueOnce([]);
    await topRevenueServices(3);
    const callArg = mockedGroupBy.mock.calls[0][0];
    expect(callArg.where).toMatchObject({ deletedAt: null, type: "Revenue" });
  });
});

describe("paymentModeMix", () => {
  it("groups inflow and outflow per mode", async () => {
    mockedGroupBy.mockResolvedValueOnce([
      { paymentMode: "HDFC Bank", type: "Revenue", _sum: { amount: { toString: () => "1000" } } },
      { paymentMode: "HDFC Bank", type: "Expense", _sum: { amount: { toString: () => "400" } } },
      { paymentMode: "Axis Bank", type: "Revenue", _sum: { amount: { toString: () => "300" } } },
    ]);
    const r = await paymentModeMix();
    const hdfc = r.find((m) => m.mode === "HDFC Bank")!;
    expect(hdfc).toEqual({ mode: "HDFC Bank", inflow: 1000, outflow: 400 });
    const axis = r.find((m) => m.mode === "Axis Bank")!;
    expect(axis).toEqual({ mode: "Axis Bank", inflow: 300, outflow: 0 });
  });
});
