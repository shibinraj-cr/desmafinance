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
 *
 * Implementation note: this used to do one Prisma groupBy per prior month
 * (N+1 round-trips). Now it pulls every relevant row in a single query and
 * buckets in memory, which on Vercel + Neon shaves ~150-400ms off page load.
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

  // Fetch every active transaction in the FY months up to and including the
  // current month (we'll filter to same-day-of-month windows in JS).
  const earliest = new Date(Date.UTC(FY_FIRST_YEAR, 3, 1)); // Apr 1, 2026
  const latest = new Date(Date.UTC(year, month, day + 1));

  // Skip the DB hit entirely when we're outside the FY entirely.
  const rows = inFy
    ? await prisma.transaction.findMany({
        where: {
          deletedAt: null,
          date: { gte: earliest, lt: latest },
        },
        select: { date: true, type: true, amount: true },
      })
    : [];

  // Bucket by FY-month-index, filtered to day-of-month <= day so each window
  // is comparable. For prior months, day-of-month <= day is automatic up to
  // their natural length. For the current month, latest already caps to day.
  type Bucket = { revenue: number; expense: number };
  const buckets: Bucket[] = Array.from({ length: 12 }, () => ({ revenue: 0, expense: 0 }));
  for (const r of rows) {
    const dom = r.date.getUTCDate();
    if (dom > day) continue;
    const m = r.date.getUTCMonth();
    const yr = r.date.getUTCFullYear();
    const idx = (yr - FY_FIRST_YEAR) * 12 + (m - 3);
    if (idx < 0 || idx > thisFyIndex) continue;
    const v = num(r.amount);
    if (r.type === "Revenue") buckets[idx].revenue += v;
    else if (r.type === "Expense") buckets[idx].expense += v;
  }

  const thisBucket = buckets[Math.max(0, Math.min(11, thisFyIndex))];
  const priorBuckets = buckets.slice(0, Math.max(0, thisFyIndex));
  const lastPrior = priorBuckets.length ? priorBuckets[priorBuckets.length - 1] : null;

  const avg = (key: "revenue" | "expense") => {
    if (priorBuckets.length === 0) return null;
    return priorBuckets.reduce((s, p) => s + p[key], 0) / priorBuckets.length;
  };

  const baseMeta = {
    asOfDay: day,
    thisMonthLabel,
    prevMonthLabel,
    isFirstMonth,
    priorMonthCount: priorBuckets.length,
  };

  const thisRevenue = thisBucket.revenue;
  const thisExpense = thisBucket.expense;

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
        priorBuckets.length === 0
          ? null
          : priorBuckets.reduce((s, p) => s + (p.revenue - p.expense), 0) /
            priorBuckets.length,
    },
  };
}

/** Helper: percentage delta with safe division. Returns null when baseline is 0. */
export function deltaPct(current: number, baseline: number | null): number | null {
  if (baseline === null || baseline === 0) return null;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}
