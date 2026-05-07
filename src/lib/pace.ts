import { prisma } from "./prisma";
import { MONTH_LABELS } from "./period";

export type PaceMetric = {
  /** This month's value summed from day 1 to today's day-of-month inclusive. */
  thisMtd: number;
  /** Same window in the immediately preceding month (or null for first FY month). */
  prevMtd: number | null;
  /** Average of same windows across every prior FY month. */
  trailingAvg: number | null;
  /** How many prior months contributed to trailingAvg. */
  priorMonthCount: number;
  asOfDay: number;
  thisMonthLabel: string;
  prevMonthLabel: string | null;
  isFirstMonth: boolean;
};

export type Pace = {
  revenue: PaceMetric;
  expense: PaceMetric;
  net: PaceMetric;
  asOfDate: Date;
};

const FY_FIRST_YEAR = 2026; // Apr 2026 is FY-month index 0

function num(d: { toString(): string } | null | undefined): number {
  if (d === null || d === undefined) return 0;
  return Number(d.toString());
}

/**
 * Compute as-on-date pacing comparisons for the current FY month against
 * every prior FY month, restricted to the same day-of-month window so the
 * comparisons are calendar-fair (e.g. May 1–7 vs Apr 1–7).
 */
export async function pace(asOfDate: Date = new Date()): Promise<Pace> {
  const day = asOfDate.getUTCDate();
  const year = asOfDate.getUTCFullYear();
  const month = asOfDate.getUTCMonth(); // 0-indexed

  // FY-month index: Apr 2026 = 0, May 2026 = 1, ..., Mar 2027 = 11.
  const thisFyIndex = (year - FY_FIRST_YEAR) * 12 + (month - 3);
  const inFy = thisFyIndex >= 0 && thisFyIndex < 12;

  const thisMonthLabel = inFy ? MONTH_LABELS[thisFyIndex] : `${month + 1}/${year}`;
  const prevMonthLabel =
    inFy && thisFyIndex > 0 ? MONTH_LABELS[thisFyIndex - 1] : null;
  const isFirstMonth = thisFyIndex === 0;

  // Half-open window [start, end)
  const thisStart = new Date(Date.UTC(year, month, 1));
  const thisEnd = new Date(Date.UTC(year, month, day + 1));

  // Collect every prior FY month strictly before the current one.
  const priorWindows: { label: string; start: Date; end: Date }[] = [];
  for (let i = 0; i < 12 && i < thisFyIndex; i++) {
    const m = (3 + i) % 12;
    const yr = FY_FIRST_YEAR + Math.floor((3 + i) / 12);
    priorWindows.push({
      label: MONTH_LABELS[i],
      start: new Date(Date.UTC(yr, m, 1)),
      // Cap to "day"; if the prior month has fewer than `day` days, JS Date
      // handles overflow correctly (e.g. Feb 30 → Mar 2). For our FY months
      // (Apr–Mar) only Feb-27 has fewer than 30 days, and at day=30 the
      // overflow falls into Mar-27 which is fine — Mar-27 is itself a
      // separate FY month so any current-month index > Feb-27 already
      // excludes it from being a "prior" window.
      end: new Date(Date.UTC(yr, m, day + 1)),
    });
  }

  // Aggregate this month's MTD by type.
  const thisRows = await prisma.transaction.groupBy({
    by: ["type"],
    where: {
      deletedAt: null,
      date: { gte: thisStart, lt: thisEnd },
    },
    _sum: { amount: true },
  });
  const thisRevenue = num(thisRows.find((r) => r.type === "Revenue")?._sum.amount);
  const thisExpense = num(thisRows.find((r) => r.type === "Expense")?._sum.amount);

  // For each prior month, aggregate same-window totals in parallel.
  const priorAggs = await Promise.all(
    priorWindows.map(async (w) => {
      const rows = await prisma.transaction.groupBy({
        by: ["type"],
        where: {
          deletedAt: null,
          date: { gte: w.start, lt: w.end },
        },
        _sum: { amount: true },
      });
      return {
        label: w.label,
        revenue: num(rows.find((r) => r.type === "Revenue")?._sum.amount),
        expense: num(rows.find((r) => r.type === "Expense")?._sum.amount),
      };
    }),
  );

  const lastPrior = priorAggs.length ? priorAggs[priorAggs.length - 1] : null;
  const avg = (key: "revenue" | "expense") => {
    if (priorAggs.length === 0) return null;
    return priorAggs.reduce((s, p) => s + p[key], 0) / priorAggs.length;
  };

  const baseMeta = {
    asOfDay: day,
    thisMonthLabel,
    prevMonthLabel,
    isFirstMonth,
    priorMonthCount: priorAggs.length,
  };

  return {
    asOfDate,
    revenue: {
      ...baseMeta,
      thisMtd: thisRevenue,
      prevMtd: lastPrior?.revenue ?? null,
      trailingAvg: avg("revenue"),
    },
    expense: {
      ...baseMeta,
      thisMtd: thisExpense,
      prevMtd: lastPrior?.expense ?? null,
      trailingAvg: avg("expense"),
    },
    net: {
      ...baseMeta,
      thisMtd: thisRevenue - thisExpense,
      prevMtd: lastPrior ? lastPrior.revenue - lastPrior.expense : null,
      trailingAvg:
        priorAggs.length === 0
          ? null
          : priorAggs.reduce((s, p) => s + (p.revenue - p.expense), 0) / priorAggs.length,
    },
  };
}

/** Helper: percentage delta with safe division. Returns null when baseline is 0. */
export function deltaPct(current: number, baseline: number | null): number | null {
  if (baseline === null || baseline === 0) return null;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}
