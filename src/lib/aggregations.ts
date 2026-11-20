import { prisma } from "./prisma";
import type { Range } from "./period";
import { listParam, oneOf } from "./filter-params";
import { isGstRemittance } from "./finance-gst";

/**
 * Two views of the same rows (src/lib/finance-gst.ts):
 *   - revenue / expense / net: the P&L. Revenue NET of GST, expenses without
 *     GST paid over to the government.
 *   - inflow / outflow / cashNet: the money. Every rupee in and out.
 */
export type MonthBucket = {
  month: string;
  revenue: number;
  expense: number;
  net: number;
  inflow: number;
  outflow: number;
  cashNet: number;
};

export type Totals = {
  /** Revenue net of GST. */
  revenue: number;
  /** Expenses, leaving out GST paid to the government. */
  expense: number;
  /** revenue − expense: the profit figure. */
  net: number;
  /** GST inside the period's revenue. */
  gst: number;
  /** GST paid to the government in the period (Expense › Taxes › GST). */
  gstPaid: number;
  /** Money received, GST included. */
  inflow: number;
  /** Money paid out, GST paid included. */
  outflow: number;
  cashNet: number;
};

type Row = {
  type: string;
  category?: string | null;
  subItem?: string | null;
  _sum: { amount?: { toString(): string } | number | null; gstAmount?: { toString(): string } | number | null };
};

/** Fold grouped ledger rows into both views. */
function fold(rows: Row[], into: Omit<Totals, "net" | "cashNet">) {
  for (const r of rows) {
    const amount = num(r._sum.amount);
    if (r.type === "Revenue") {
      const gst = num(r._sum.gstAmount);
      into.inflow += amount;
      into.gst += gst;
      into.revenue += amount - gst;
    } else if (r.type === "Expense") {
      into.outflow += amount;
      if (isGstRemittance(r)) into.gstPaid += amount;
      else into.expense += amount;
    }
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const MONTH_ORDER = [
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
];

function num(d: { toString(): string } | number | null | undefined): number {
  if (d === null || d === undefined) return 0;
  return typeof d === "number" ? d : Number(d.toString());
}

/**
 * Shared `where` for every dashboard aggregate: live rows only (not deleted,
 * not a pre-DesGro historical payment), narrowed by
 * the period and — where the caller passes one — by the payment-mode
 * multi-select. `modes` is the raw repeated `?mode=` param, so it takes the
 * same shape the pages read out of `searchParams`; an empty list means "all
 * modes" rather than "no modes".
 */
function activeWhere(range?: Range, modes?: string[]) {
  const picked = listParam(modes);
  return {
    deletedAt: null,
    // Payments from before DesGro sit outside these books (finance-historical.ts).
    isHistorical: false,
    ...(picked.length ? { paymentMode: oneOf(picked) } : {}),
    ...(range?.from || range?.to
      ? {
          date: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to ? { lt: range.to } : {}),
          },
        }
      : {}),
  };
}

export async function totalsByType(range?: Range, modes?: string[]): Promise<Totals> {
  const rows = await prisma.transaction.groupBy({
    // Category and sub-item pick out GST paid to the government.
    by: ["type", "category", "subItem"],
    where: activeWhere(range, modes),
    _sum: { amount: true, gstAmount: true },
  });
  const t = { revenue: 0, expense: 0, gst: 0, gstPaid: 0, inflow: 0, outflow: 0 };
  fold(rows, t);
  return {
    revenue: r2(t.revenue),
    expense: r2(t.expense),
    net: r2(t.revenue - t.expense),
    gst: r2(t.gst),
    gstPaid: r2(t.gstPaid),
    inflow: r2(t.inflow),
    outflow: r2(t.outflow),
    cashNet: r2(t.inflow - t.outflow),
  };
}

export async function monthlySeries(range?: Range, modes?: string[]): Promise<MonthBucket[]> {
  const rows = await prisma.transaction.groupBy({
    by: ["month", "type", "category", "subItem"],
    where: activeWhere(range, modes),
    _sum: { amount: true, gstAmount: true },
  });
  const empty = (month: string) => ({ month, revenue: 0, expense: 0, gst: 0, gstPaid: 0, inflow: 0, outflow: 0 });
  const map = new Map<string, ReturnType<typeof empty>>();
  for (const m of MONTH_ORDER) map.set(m, empty(m));
  for (const r of rows) {
    const bucket = map.get(r.month) ?? empty(r.month);
    fold([r], bucket);
    map.set(r.month, bucket);
  }
  return Array.from(map.values()).map((b) => ({
    month: b.month,
    revenue: r2(b.revenue),
    expense: r2(b.expense),
    net: r2(b.revenue - b.expense),
    inflow: r2(b.inflow),
    outflow: r2(b.outflow),
    cashNet: r2(b.inflow - b.outflow),
  }));
}

/** A series in the shape the cash charts read: revenue/expense/net = money in/out/net. */
export function asCashSeries(series: MonthBucket[]): MonthBucket[] {
  return series.map((b) => ({ ...b, revenue: b.inflow, expense: b.outflow, net: b.cashNet }));
}

export async function topRevenueServices(limit = 6, range?: Range, modes?: string[]) {
  const rows = await prisma.transaction.groupBy({
    by: ["subItem"],
    where: { ...activeWhere(range, modes), type: "Revenue" },
    _sum: { amount: true, gstAmount: true },
  });
  return rows
    .map((r) => ({ name: r.subItem, value: num(r._sum.amount) - num(r._sum.gstAmount) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/**
 * Sales vs collections are tagged by "(Sales)" / "(Collection)" suffixes on
 * the sub-item label in the catalog. Split them so management can read new
 * pipeline distinctly from collection recovery.
 */
export async function topRevenueServicesSplit(limit = 6, range?: Range) {
  const rows = await prisma.transaction.groupBy({
    by: ["subItem", "category"],
    where: { ...activeWhere(range), type: "Revenue" },
    _sum: { amount: true, gstAmount: true },
  });
  const sales: { name: string; value: number }[] = [];
  const collections: { name: string; value: number }[] = [];
  for (const r of rows) {
    const v = num(r._sum.amount) - num(r._sum.gstAmount);
    const name = r.subItem;
    const isCollection =
      /\(Collection\)/i.test(name) || /Collection -/i.test(r.category ?? "");
    if (isCollection) collections.push({ name, value: v });
    else sales.push({ name, value: v });
  }
  sales.sort((a, b) => b.value - a.value);
  collections.sort((a, b) => b.value - a.value);
  return {
    sales: sales.slice(0, limit),
    collections: collections.slice(0, limit),
    salesTotal: sales.reduce((s, x) => s + x.value, 0),
    collectionsTotal: collections.reduce((s, x) => s + x.value, 0),
  };
}

/** Expenses by category for the P&L: GST paid to the government is left out. */
export async function expenseBreakdown(limit = 8, range?: Range) {
  const rows = await prisma.transaction.groupBy({
    by: ["category"],
    where: { ...activeWhere(range), type: "Expense", NOT: { category: "Taxes", subItem: "GST" } },
    _sum: { amount: true },
  });
  return rows
    .map((r) => ({ name: r.category, value: num(r._sum.amount) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export async function revenueByCategory(range?: Range, modes?: string[]) {
  const rows = await prisma.transaction.groupBy({
    by: ["category"],
    where: { ...activeWhere(range, modes), type: "Revenue" },
    _sum: { amount: true, gstAmount: true },
  });
  return rows
    .map((r) => ({ name: r.category, value: num(r._sum.amount) - num(r._sum.gstAmount) }))
    .sort((a, b) => b.value - a.value);
}

/** Money in and out per payment mode: cash, so GST stays in. */
export async function paymentModeMix(range?: Range) {
  const rows = await prisma.transaction.groupBy({
    by: ["paymentMode", "type"],
    where: activeWhere(range),
    _sum: { amount: true },
  });
  const map = new Map<string, { mode: string; inflow: number; outflow: number }>();
  for (const r of rows) {
    const cur = map.get(r.paymentMode) ?? { mode: r.paymentMode, inflow: 0, outflow: 0 };
    if (r.type === "Revenue") cur.inflow += num(r._sum.amount);
    else cur.outflow += num(r._sum.amount);
    map.set(r.paymentMode, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow));
}

export async function recentTransactions(limit = 10, range?: Range) {
  return prisma.transaction.findMany({
    where: activeWhere(range),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

/** Money in minus money out: a balance follows the cash, GST included. */
export async function currentBalance(range?: Range): Promise<number> {
  const t = await totalsByType(range);
  return t.cashNet;
}
