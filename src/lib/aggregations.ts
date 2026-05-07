import { prisma } from "./prisma";
import type { Range } from "./period";

export type MonthBucket = { month: string; revenue: number; expense: number; net: number };

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

function activeWhere(range?: Range) {
  return {
    deletedAt: null,
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

export async function totalsByType(range?: Range) {
  const rows = await prisma.transaction.groupBy({
    by: ["type"],
    where: activeWhere(range),
    _sum: { amount: true },
  });
  let revenue = 0;
  let expense = 0;
  for (const r of rows) {
    const v = num(r._sum.amount);
    if (r.type === "Revenue") revenue += v;
    else if (r.type === "Expense") expense += v;
  }
  return { revenue, expense, net: revenue - expense };
}

export async function monthlySeries(range?: Range): Promise<MonthBucket[]> {
  const rows = await prisma.transaction.groupBy({
    by: ["month", "type"],
    where: activeWhere(range),
    _sum: { amount: true },
  });
  const map = new Map<string, MonthBucket>();
  for (const m of MONTH_ORDER) map.set(m, { month: m, revenue: 0, expense: 0, net: 0 });
  for (const r of rows) {
    const bucket = map.get(r.month) ?? { month: r.month, revenue: 0, expense: 0, net: 0 };
    if (r.type === "Revenue") bucket.revenue += num(r._sum.amount);
    else if (r.type === "Expense") bucket.expense += num(r._sum.amount);
    bucket.net = bucket.revenue - bucket.expense;
    map.set(r.month, bucket);
  }
  return Array.from(map.values());
}

export async function topRevenueServices(limit = 6, range?: Range) {
  const rows = await prisma.transaction.groupBy({
    by: ["subItem"],
    where: { ...activeWhere(range), type: "Revenue" },
    _sum: { amount: true },
  });
  return rows
    .map((r) => ({ name: r.subItem, value: num(r._sum.amount) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export async function expenseBreakdown(limit = 8, range?: Range) {
  const rows = await prisma.transaction.groupBy({
    by: ["category"],
    where: { ...activeWhere(range), type: "Expense" },
    _sum: { amount: true },
  });
  return rows
    .map((r) => ({ name: r.category, value: num(r._sum.amount) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export async function revenueByCategory(range?: Range) {
  const rows = await prisma.transaction.groupBy({
    by: ["category"],
    where: { ...activeWhere(range), type: "Revenue" },
    _sum: { amount: true },
  });
  return rows
    .map((r) => ({ name: r.category, value: num(r._sum.amount) }))
    .sort((a, b) => b.value - a.value);
}

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

export async function currentBalance(range?: Range): Promise<number> {
  const t = await totalsByType(range);
  return t.net;
}
