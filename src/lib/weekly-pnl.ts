/**
 * Weekly P&L: net sales, net profit and net cash flow per Saturday → Friday
 * week, for the Executive "Weekly P&L" tab.
 *
 * All three figures come off the same `Transaction` rows every finance screen
 * reads. The ledger is cash-basis, so the three differ only by which rows each
 * one leaves out — and they reconcile exactly:
 *
 *   Net Sales     = all Revenue − Refunds
 *   Net Profit    = Net Sales − operating expenses
 *                   (every Expense except Refund, Buying Assets and Loan
 *                   Repayment: a refund is already netted off sales, and an
 *                   asset purchase or a loan repayment is not a cost of the
 *                   week's trading)
 *   Net Cash Flow = all Revenue − all Expense
 *                 = Net Profit − Buying Assets − Loan Repayment
 *
 * Net Cash Flow is the same "Net Cash" the Finance → Cash Flow page reports,
 * so a fiscal year's weeks sum to that page's figure for the same year.
 *
 * Two decisions worth knowing before you change anything here.
 *
 * 1. **Buckets come from `date`, never from `Transaction.month`** — the same
 *    rule the Expense Matrix follows. Dates are stored at midnight UTC for the
 *    calendar day entered, so the UTC weekday IS the business weekday.
 *
 * 2. **Weeks are clipped to the fiscal year.** A Saturday → Friday week rarely
 *    starts on 1 April, so the first and last rows of a year are part weeks
 *    (flagged `partial`). Clipping keeps every rupee in exactly one FY, which
 *    is what lets the year's rows add up to the year's total.
 */
import { prisma } from "./prisma";
import { fyEnd, fyStart } from "./fiscal-year";

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** JS weekday of the first day of a business week: Saturday. */
const WEEK_START_DAY = 6;

/** Expense categories that move cash but are not a cost of trading. */
export const NON_OPERATING_EXPENSES = ["Buying Assets", "Loan Repayment"] as const;

/** The Expense category that is netted off sales rather than counted as cost. */
export const REFUND_CATEGORY = "Refund";

export type LedgerRow = { date: Date; type: string; category: string; amount: number };

export type WeekRow = {
  /** First day in the row (a Saturday, unless clipped by the FY start). */
  from: Date;
  /** Last day in the row, inclusive (a Friday, unless clipped). */
  to: Date;
  /** Clipped by a fiscal-year boundary — fewer than seven days. */
  partial: boolean;
  /** Contains today — still filling up. */
  running: boolean;

  /** "Sales - …" categories: new enrollments booked. */
  sales: number;
  /** "Collection - …" categories: later installments received. */
  collections: number;
  /** Any other revenue (commissions etc.). */
  otherIncome: number;
  refunds: number;
  netSales: number;

  /** Every expense except refunds and the non-operating categories. */
  operatingExpense: number;
  netProfit: number;
  /** Net Profit / Net Sales, as a percentage. `null` with no net sales. */
  marginPct: number | null;

  /** Buying Assets + Loan Repayment. */
  nonOperating: number;
  netCashFlow: number;
};

export type WeeklyPnl = {
  fy: number;
  /** Newest week first. */
  weeks: WeekRow[];
  /** Sum of every week shown — the FY to date. */
  total: Omit<WeekRow, "from" | "to" | "partial" | "running">;
  /** Most recent week that has finished, or `null` before one has. */
  lastClosed: WeekRow | null;
  /** The week before `lastClosed`, for the week-on-week change. */
  priorClosed: WeekRow | null;
  /** The week in progress, when it falls inside this FY. */
  running: WeekRow | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Midnight UTC of the calendar day `d` falls on. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The Saturday on or before `d`, at midnight UTC. */
export function weekStart(d: Date): Date {
  const day = utcDay(d);
  const back = (day.getUTCDay() - WEEK_START_DAY + 7) % 7;
  return addDays(day, -back);
}

/** Today in the office's calendar (IST), as midnight UTC of that date. */
export function istToday(now: Date = new Date()): Date {
  return utcDay(new Date(now.getTime() + IST_OFFSET_MS));
}

/** Percentage change, measured against the size of the earlier figure so a
 *  loss shrinking to a smaller loss reads as an improvement. */
export function weekChange(current: number, prior: number | null | undefined): number | null {
  if (prior === null || prior === undefined || prior === 0) return null;
  return round2(((current - prior) / Math.abs(prior)) * 100);
}

type Sums = Omit<WeekRow, "from" | "to" | "partial" | "running">;

function emptySums(): Sums {
  return {
    sales: 0,
    collections: 0,
    otherIncome: 0,
    refunds: 0,
    netSales: 0,
    operatingExpense: 0,
    netProfit: 0,
    marginPct: null,
    nonOperating: 0,
    netCashFlow: 0,
  };
}

function addRow(s: Sums, r: LedgerRow) {
  if (r.type === "Revenue") {
    if (/^Sales\b/i.test(r.category)) s.sales += r.amount;
    else if (/^Collection\b/i.test(r.category)) s.collections += r.amount;
    else s.otherIncome += r.amount;
  } else if (r.type === "Expense") {
    if (r.category === REFUND_CATEGORY) s.refunds += r.amount;
    else if ((NON_OPERATING_EXPENSES as readonly string[]).includes(r.category))
      s.nonOperating += r.amount;
    else s.operatingExpense += r.amount;
  }
}

/** Derive the net lines from the raw buckets and round everything once. */
function finish<T extends Sums>(s: T): T {
  s.sales = round2(s.sales);
  s.collections = round2(s.collections);
  s.otherIncome = round2(s.otherIncome);
  s.refunds = round2(s.refunds);
  s.operatingExpense = round2(s.operatingExpense);
  s.nonOperating = round2(s.nonOperating);
  s.netSales = round2(s.sales + s.collections + s.otherIncome - s.refunds);
  s.netProfit = round2(s.netSales - s.operatingExpense);
  s.netCashFlow = round2(s.netProfit - s.nonOperating);
  s.marginPct = s.netSales > 0 ? round2((s.netProfit / s.netSales) * 100) : null;
  return s;
}

/**
 * Shape ledger rows into Saturday → Friday weeks. Pure — every rule that
 * decides what a reader sees lives here and is unit-tested without a database.
 *
 * Weeks run from the one holding 1 April up to the one holding `today` (or the
 * FY's last day, for a finished year). Rows outside the FY are ignored.
 */
export function buildWeeklyPnl({
  fy,
  rows,
  today,
}: {
  fy: number;
  rows: LedgerRow[];
  today: Date;
}): WeeklyPnl {
  const start = fyStart(fy);
  const end = fyEnd(fy); // exclusive
  const lastDay = addDays(end, -1);
  const through = today < lastDay ? today : lastDay;

  const weeks: WeekRow[] = [];
  if (through >= start) {
    for (let ws = weekStart(start); ws <= through; ws = addDays(ws, 7)) {
      const from = ws < start ? start : ws;
      const naturalTo = addDays(ws, 6);
      const to = naturalTo > lastDay ? lastDay : naturalTo;
      weeks.push({
        from,
        to,
        partial: from.getTime() !== ws.getTime() || to.getTime() !== naturalTo.getTime(),
        running: today >= from && today <= to,
        ...emptySums(),
      });
    }
  }

  const index = new Map(weeks.map((w, i) => [weekStart(w.from).getTime(), i]));
  const total = emptySums();
  for (const r of rows) {
    const day = utcDay(r.date);
    if (day < start || day >= end || day > through) continue;
    const i = index.get(weekStart(day).getTime());
    if (i === undefined) continue;
    addRow(weeks[i], r);
    addRow(total, r);
  }
  weeks.forEach(finish);
  finish(total);

  // Oldest → newest at this point; the closed weeks are every one before the
  // running week (or all of them, for a finished year).
  const closed = weeks.filter((w) => !w.running && w.to < today);
  const running = weeks.find((w) => w.running) ?? null;

  return {
    fy,
    weeks: weeks.slice().reverse(),
    total,
    lastClosed: closed[closed.length - 1] ?? null,
    priorClosed: closed[closed.length - 2] ?? null,
    running,
  };
}

/** Read one fiscal year of the ledger and bucket it into weeks. */
export async function weeklyPnl(fy: number, now: Date = new Date()): Promise<WeeklyPnl> {
  const rows = await prisma.transaction.findMany({
    where: { deletedAt: null, date: { gte: fyStart(fy), lt: fyEnd(fy) } },
    select: { date: true, type: true, category: true, amount: true },
  });
  return buildWeeklyPnl({
    fy,
    today: istToday(now),
    rows: rows.map((r) => ({
      date: r.date,
      type: r.type,
      category: r.category,
      amount: Number(r.amount.toString()),
    })),
  });
}
