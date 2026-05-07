import { prisma } from "./prisma";

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

const ACTIVE = { deletedAt: null } as const;

function num(d: { toString(): string } | number | null | undefined): number {
  if (d === null || d === undefined) return 0;
  return typeof d === "number" ? d : Number(d.toString());
}

export async function totalsByType() {
  const rows = await prisma.transaction.groupBy({
    by: ["type"],
    where: ACTIVE,
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

export async function monthlySeries(): Promise<MonthBucket[]> {
  const rows = await prisma.transaction.groupBy({
    by: ["month", "type"],
    where: ACTIVE,
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

export async function topRevenueServices(limit = 6) {
  const rows = await prisma.transaction.groupBy({
    by: ["subItem"],
    where: { ...ACTIVE, type: "Revenue" },
    _sum: { amount: true },
  });
  return rows
    .map((r) => ({ name: r.subItem, value: num(r._sum.amount) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export async function expenseBreakdown(limit = 8) {
  const rows = await prisma.transaction.groupBy({
    by: ["category"],
    where: { ...ACTIVE, type: "Expense" },
    _sum: { amount: true },
  });
  return rows
    .map((r) => ({ name: r.category, value: num(r._sum.amount) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export async function revenueByCategory() {
  const rows = await prisma.transaction.groupBy({
    by: ["category"],
    where: { ...ACTIVE, type: "Revenue" },
    _sum: { amount: true },
  });
  return rows
    .map((r) => ({ name: r.category, value: num(r._sum.amount) }))
    .sort((a, b) => b.value - a.value);
}

export async function paymentModeMix() {
  const rows = await prisma.transaction.groupBy({
    by: ["paymentMode", "type"],
    where: ACTIVE,
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

export async function recentTransactions(limit = 10) {
  return prisma.transaction.findMany({
    where: ACTIVE,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

export async function currentBalance(): Promise<number> {
  const t = await totalsByType();
  return t.net;
}
