/**
 * The Expense Matrix: every spend category by fiscal month, with the same
 * months of the previous fiscal year beside it.
 *
 * Two decisions worth knowing before you change anything here.
 *
 * 1. **Buckets come from `date`, never from `Transaction.month`.** The month
 *    label is written by the app and could, in principle, disagree with the
 *    row's own date. The Expense Tracker filters by `date`, so bucketing by
 *    the label would let this page quietly report a different total than the
 *    page it sits next to. Reading the rows and bucketing in JS costs one
 *    query of three narrow columns and removes that whole class of drift.
 *
 * 2. **The year-on-year comparison is like-for-like.** A fiscal year six
 *    months in, set against twelve months of the year before, reads as a
 *    collapse in spend when it is nothing of the sort. Every `prior*` total
 *    here covers exactly the months the current year has posted.
 */
import { prisma } from "./prisma";
import {
  LEDGER_FIRST_FY,
  fyEnd,
  fyMonthIndex,
  fyStart,
  postedMonthCount,
} from "./fiscal-year";

/** Categories beyond the top few are folded into this row. */
export const OTHER_ROW = "Other categories";

/** How many categories keep their own row before the fold. */
export const TOP_CATEGORIES = 8;

/** One category's spend in one fiscal month. */
export type ExpenseCell = { category: string; monthIndex: number; amount: number };

export type MatrixRow = {
  name: string;
  /** Twelve fiscal months, Apr → Mar. `null` for a month that has not begun. */
  months: (number | null)[];
  /** Spend across the posted months. */
  total: number;
  /** The prior FY's twelve months, or `null` when that year isn't in the ledger. */
  priorMonths: number[] | null;
  /** The prior FY across the *same* months as `total`. */
  priorTotal: number | null;
  /** Change on `priorTotal`, as a percentage. `null` without a comparable year. */
  changePct: number | null;
  /** True for the folded "Other categories" row, which is a bucket, not a peer. */
  isOther: boolean;
};

export type ExpenseMatrix = {
  fy: number;
  /** How many of the twelve months have begun. */
  postedMonths: number;
  rows: MatrixRow[];
  /** Column totals; `null` for a month that has not begun. */
  monthTotals: (number | null)[];
  priorMonthTotals: number[] | null;
  total: number;
  priorTotal: number | null;
  changePct: number | null;
  /** Distinct categories with spend this year, before the fold. */
  categoryCount: number;
  /** Whether the previous FY holds any expense at all. */
  hasPrior: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Percentage change, or `null` when there is nothing to compare against. */
export function changeOn(current: number, prior: number | null): number | null {
  if (prior === null || prior === 0) return null;
  return round2(((current - prior) / prior) * 100);
}

function emptyMonths(): number[] {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/**
 * Shape bucketed cells into the grid. Pure — every rule that decides what a
 * reader sees lives here, and is unit-tested without a database.
 */
export function buildExpenseMatrix({
  fy,
  current,
  prior,
  postedMonths,
  topN = TOP_CATEGORIES,
}: {
  fy: number;
  current: ExpenseCell[];
  prior: ExpenseCell[] | null;
  postedMonths: number;
  topN?: number;
}): ExpenseMatrix {
  const posted = Math.max(0, Math.min(12, postedMonths));

  // Rank categories on this year's spend, then fold the tail. The prior year
  // is mapped through the *same* fold, so a row means the same thing on both
  // sides of the comparison even if last year's ranking differed.
  const currentByCategory = new Map<string, number>();
  for (const c of current) {
    currentByCategory.set(c.category, (currentByCategory.get(c.category) ?? 0) + c.amount);
  }
  const ranked = Array.from(currentByCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  const kept = new Set(ranked.slice(0, topN));

  // Categories that only the prior year has can't earn a row of their own —
  // they'd show a bar against an empty one — so they land in the fold.
  const bucketOf = (category: string) => (kept.has(category) ? category : OTHER_ROW);

  const currentRows = new Map<string, number[]>();
  for (const c of current) {
    const key = bucketOf(c.category);
    const months = currentRows.get(key) ?? emptyMonths();
    months[c.monthIndex] += c.amount;
    currentRows.set(key, months);
  }

  const priorRows = new Map<string, number[]>();
  if (prior) {
    for (const c of prior) {
      const key = bucketOf(c.category);
      const months = priorRows.get(key) ?? emptyMonths();
      months[c.monthIndex] += c.amount;
      priorRows.set(key, months);
    }
  }

  const hasPrior = prior !== null && prior.length > 0;
  const names = Array.from(new Set([...currentRows.keys(), ...priorRows.keys()]));

  const rows: MatrixRow[] = names.map((name) => {
    const raw = currentRows.get(name) ?? emptyMonths();
    const months = raw.map((v, i) => (i < posted ? round2(v) : null));
    const total = round2(raw.slice(0, posted).reduce((s, v) => s + v, 0));

    const priorRaw = hasPrior ? (priorRows.get(name) ?? emptyMonths()) : null;
    const priorMonths = priorRaw ? priorRaw.map(round2) : null;
    const priorTotal = priorRaw
      ? round2(priorRaw.slice(0, posted).reduce((s, v) => s + v, 0))
      : null;

    return {
      name,
      months,
      total,
      priorMonths,
      priorTotal,
      changePct: changeOn(total, priorTotal),
      isOther: name === OTHER_ROW,
    };
  });

  // Heaviest first, but the fold stays pinned to the bottom: it is a sum of
  // leftovers, and sorting it among real categories invites reading it as one.
  rows.sort((a, b) => {
    if (a.isOther !== b.isOther) return a.isOther ? 1 : -1;
    return b.total - a.total;
  });

  const monthTotals = Array.from({ length: 12 }, (_, i) =>
    i < posted ? round2(rows.reduce((s, r) => s + (r.months[i] ?? 0), 0)) : null,
  );
  const priorMonthTotals = hasPrior
    ? Array.from({ length: 12 }, (_, i) =>
        round2(rows.reduce((s, r) => s + (r.priorMonths?.[i] ?? 0), 0)),
      )
    : null;

  const total = round2(rows.reduce((s, r) => s + r.total, 0));
  const priorTotal = hasPrior
    ? round2(rows.reduce((s, r) => s + (r.priorTotal ?? 0), 0))
    : null;

  return {
    fy,
    postedMonths: posted,
    rows,
    monthTotals,
    priorMonthTotals,
    total,
    priorTotal,
    changePct: changeOn(total, priorTotal),
    categoryCount: currentByCategory.size,
    hasPrior,
  };
}

/**
 * The two facts worth a headline tile: the month that cost the most (and what
 * drove it), and the category growing fastest on last year. Both are `null`
 * when the matrix has nothing to say — an unposted year, or no prior year.
 */
export function matrixHighlights(m: ExpenseMatrix): {
  peak: { monthIndex: number; amount: number; leader: string } | null;
  mover: { name: string; changePct: number; total: number } | null;
} {
  let peakIndex = -1;
  let peakAmount = 0;
  for (let i = 0; i < m.monthTotals.length; i++) {
    const t = m.monthTotals[i];
    if (t === null || t <= 0) continue;
    if (peakIndex === -1 || t > peakAmount) {
      peakIndex = i;
      peakAmount = t;
    }
  }
  const peak =
    peakIndex === -1 || m.rows.length === 0
      ? null
      : {
          monthIndex: peakIndex,
          amount: peakAmount,
          leader: m.rows.reduce((best, r) =>
            (r.months[peakIndex] ?? 0) > (best.months[peakIndex] ?? 0) ? r : best,
          ).name,
        };

  let mover: { name: string; changePct: number; total: number } | null = null;
  for (const r of m.rows) {
    // A category that didn't exist last year has no growth rate, only a start;
    // ranking it as "fastest growing" would be an artefact of the fold.
    if (r.changePct === null || r.isOther) continue;
    if (!mover || r.changePct > mover.changePct) {
      mover = { name: r.name, changePct: r.changePct, total: r.total };
    }
  }

  return { peak, mover };
}

/** Reads expense rows for one FY and buckets them by category and fiscal month. */
async function cellsForFy(fy: number): Promise<ExpenseCell[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      type: "Expense",
      deletedAt: null,
      date: { gte: fyStart(fy), lt: fyEnd(fy) },
    },
    select: { date: true, category: true, amount: true },
  });
  return rows.map((r) => ({
    category: r.category || "Uncategorised",
    monthIndex: fyMonthIndex(r.date),
    amount: Number(r.amount.toString()),
  }));
}

/** The matrix for one fiscal year, with the year before it where the ledger reaches. */
export async function expenseMatrix(
  fy: number,
  now: Date = new Date(),
): Promise<ExpenseMatrix> {
  const wantsPrior = fy - 1 >= LEDGER_FIRST_FY;
  const [current, prior] = await Promise.all([
    cellsForFy(fy),
    wantsPrior ? cellsForFy(fy - 1) : Promise.resolve(null),
  ]);
  return buildExpenseMatrix({
    fy,
    current,
    prior,
    postedMonths: postedMonthCount(fy, now),
  });
}
