// CEO Dashboard — cross-module rollup combining Finance (Transactions,
// Collection Plans), Marketing (Lead Pulse pipeline + closes) and HR
// (User roster + Salary expense category) into one screen.
//
// All numbers are sourced from the same tables the per-module pages use,
// so the CEO view never drifts from what Finance / Marketing dashboards
// show.

import { prisma } from "./prisma";
import { FY_START, FY_END, MONTH_LABELS } from "./period";

function num(d: { toString(): string } | number | null | undefined): number {
  if (d === null || d === undefined) return 0;
  return typeof d === "number" ? d : Number(d.toString());
}

/** YYYY-MM index used by the L1/L2 funnel queries. */
function fyMonthKey(year: number, monthIdx0: number): { y: number; m1: number } {
  // monthIdx0 is 0-based JS month
  return { y: year, m1: monthIdx0 + 1 };
}

/** "Apr-26" style label from a Date. */
function monthLabel(d: Date): string {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const y = String(d.getUTCFullYear()).slice(-2);
  return `${m}-${y}`;
}

export type CeoHeadline = {
  currentMonthLabel: string;
  /** Revenue realised so far in the running calendar month. */
  currentMonthRevenue: number;
  /** Revenue realised in the previous calendar month — used to compute the trend chip. */
  previousMonthRevenue: number;
  currentMonthRevenueTrendPct: number | null;

  /** Sum of CollectionPlanInstallment.amount that are still Pending
   *  Submission (status='pending') and due in the running calendar month. */
  expectedCollections: number;
  expectedCollectionsCount: number;

  /** Sum of LeadPulsePipeline.expectedFirstInstallment where status='open'
   *  AND expectedCloseDate falls within the running calendar month. This
   *  matches what the Lead Pulse "Pipeline Forecast — <month>" card
   *  reports, so the two views agree. */
  pipelineValue: number;
  pipelineCount: number;

  /** Open pipeline rows whose expectedCloseDate falls outside the
   *  running calendar month — future-month forecasts plus overdue-but-
   *  still-open rows. Together with pipelineValue this is a clean
   *  partition of every open pipeline row. */
  pipelineValueBeyond: number;
  pipelineCountBeyond: number;

  /** Total pending = Pending-Submission collections (this month) +
   *  this month's open pipeline (pipelineValue). Beyond-month pipeline is
   *  shown separately and is NOT included here. */
  totalPending: number;

  /** Finance approval queue — distinct from collection plans. Surfaced so the
   *  CEO can see if any reviews are stuck. */
  pendingApprovalsCount: number;

  /** Sum of unsubmitted TransactionDraft.amount (across all users) of
   *  type Revenue dated in the running calendar month — revenue captured
   *  on the My Drafts workflow but not yet pushed to the approval queue. */
  myDraftsRevenue: number;
  myDraftsRevenueCount: number;

  /** Sum of pending-approval (kind='create', status='pending') proposed
   *  Revenue amounts dated in the running calendar month — new revenue
   *  entries awaiting a manager/admin's approval. */
  pendingApprovalRevenue: number;
  pendingApprovalRevenueCount: number;
};

/** Run a Prisma query and degrade gracefully on failure: log the cause to
 *  the server console (visible in Vercel function logs) and return the
 *  caller-supplied fallback. The CEO Dashboard reaches into Marketing /
 *  Finance / HR tables — if one is missing/misconfigured we don't want
 *  the whole page to crash. */
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[ceo-dashboard] ${label} failed`, err);
    return fallback;
  }
}

export async function ceoHeadline(): Promise<CeoHeadline> {
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const [cur, prev, plans, pipelineCurrent, pipelineBeyond, approvals, drafts, pendingApprovalRows] =
    await Promise.all([
    safe(
      "transaction.aggregate(currentMonthRevenue)",
      () =>
        prisma.transaction.aggregate({
          where: {
            deletedAt: null,
            type: "Revenue",
            date: { gte: currentMonthStart, lt: nextMonthStart },
          },
          _sum: { amount: true },
        }),
      { _sum: { amount: null as null | { toString(): string } } },
    ),
    safe(
      "transaction.aggregate(previousMonthRevenue)",
      () =>
        prisma.transaction.aggregate({
          where: {
            deletedAt: null,
            type: "Revenue",
            date: { gte: prevMonthStart, lt: currentMonthStart },
          },
          _sum: { amount: true },
        }),
      { _sum: { amount: null as null | { toString(): string } } },
    ),
    safe(
      "collectionPlanInstallment.aggregate(expectedCollections)",
      () =>
        prisma.collectionPlanInstallment.aggregate({
          // Pending Submission, due in the running calendar month.
          where: {
            status: "pending",
            expectedDate: { gte: currentMonthStart, lt: nextMonthStart },
          },
          _sum: { amount: true },
          _count: { _all: true },
        }),
      {
        _sum: { amount: null as null | { toString(): string } },
        _count: { _all: 0 },
      },
    ),
    // Pipeline split into "current month" vs "beyond" so the headline
    // matches the Lead Pulse month-bound Pipeline Forecast tile.
    // Rows with NO expectedCloseDate are grouped under "beyond" so
    // every open row is represented somewhere in the dashboard.
    safe(
      "leadPulsePipeline.aggregate(pipelineCurrent)",
      () =>
        prisma.leadPulsePipeline.aggregate({
          where: {
            status: "open",
            expectedCloseDate: { gte: currentMonthStart, lt: nextMonthStart },
          },
          _sum: { expectedFirstInstallment: true },
          _count: { _all: true },
        }),
      {
        _sum: { expectedFirstInstallment: null as null | { toString(): string } },
        _count: { _all: 0 },
      },
    ),
    safe(
      "leadPulsePipeline.aggregate(pipelineBeyond)",
      () =>
        prisma.leadPulsePipeline.aggregate({
          where: {
            status: "open",
            // Every open row that isn't expected to land *this* month —
            // covers both future-month forecasts and overdue rows that
            // haven't been moved to closed_won / lost yet. Together with
            // pipelineCurrent this is a clean partition of all open rows.
            OR: [
              { expectedCloseDate: { lt: currentMonthStart } },
              { expectedCloseDate: { gte: nextMonthStart } },
            ],
          },
          _sum: { expectedFirstInstallment: true },
          _count: { _all: true },
        }),
      {
        _sum: { expectedFirstInstallment: null as null | { toString(): string } },
        _count: { _all: 0 },
      },
    ),
    safe(
      "pendingApproval.count",
      () => prisma.pendingApproval.count({ where: { status: "pending" } }),
      0,
    ),
    // Unsubmitted Revenue drafts (all users) dated this month — captured
    // but not yet in the approval queue or the ledger.
    safe(
      "transactionDraft.aggregate(myDraftsRevenue)",
      () =>
        prisma.transactionDraft.aggregate({
          where: {
            type: "Revenue",
            date: { gte: currentMonthStart, lt: nextMonthStart },
          },
          _sum: { amount: true },
          _count: { _all: true },
        }),
      {
        _sum: { amount: null as null | { toString(): string } },
        _count: { _all: 0 },
      },
    ),
    // Pending CREATE approvals — proposed Revenue values live in the
    // `proposed` JSON blob, so we fetch the rows and sum in JS (filtering
    // by type + month below). The queue is small, so this is cheap.
    safe(
      "pendingApproval.findMany(pendingApprovalRevenue)",
      () =>
        prisma.pendingApproval.findMany({
          where: { status: "pending", kind: "create" },
          select: { proposed: true },
        }),
      [] as Array<{ proposed: unknown }>,
    ),
  ]);

  const currentMonthRevenue = num(cur._sum.amount);
  const previousMonthRevenue = num(prev._sum.amount);
  const currentMonthRevenueTrendPct =
    previousMonthRevenue > 0
      ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
      : null;
  const expectedCollections = num(plans._sum.amount);
  const pipelineValue = num(pipelineCurrent._sum.expectedFirstInstallment);
  const pipelineValueBeyond = num(pipelineBeyond._sum.expectedFirstInstallment);
  const myDraftsRevenue = num(drafts._sum.amount);

  // Sum the proposed Revenue amounts sitting in the pending-approval
  // queue, scoped to entries dated in the running calendar month.
  let pendingApprovalRevenue = 0;
  let pendingApprovalRevenueCount = 0;
  for (const row of pendingApprovalRows) {
    const p = row.proposed as { type?: string; amount?: number; date?: string } | null;
    if (!p || p.type !== "Revenue") continue;
    const when = p.date ? new Date(p.date) : null;
    if (!when || isNaN(when.getTime()) || when < currentMonthStart || when >= nextMonthStart) {
      continue;
    }
    pendingApprovalRevenue += num(p.amount);
    pendingApprovalRevenueCount += 1;
  }

  return {
    currentMonthLabel: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
    currentMonthRevenue,
    previousMonthRevenue,
    currentMonthRevenueTrendPct,
    expectedCollections,
    expectedCollectionsCount: plans._count._all,
    pipelineValue,
    pipelineCount: pipelineCurrent._count._all,
    pipelineValueBeyond,
    pipelineCountBeyond: pipelineBeyond._count._all,
    totalPending: expectedCollections + pipelineValue,
    pendingApprovalsCount: approvals,
    myDraftsRevenue,
    myDraftsRevenueCount: drafts._count._all,
    pendingApprovalRevenue,
    pendingApprovalRevenueCount,
  };
}

export type MonthlyRow = {
  /** "Apr-26" style label. */
  month: string;
  /** JS Date for the first of the month (UTC). */
  date: Date;
  revenue: number;
  expense: number;
  net: number;
  /** Count of LeadPulseDailyClose rows whose entry sits in the month —
   *  the "enrollments" metric the CEO tracks. */
  enrollments: number;
};

/** 12 fiscal-year buckets — Apr → Mar — pre-filled with zeros and then
 *  hydrated from transactions + daily closes. We anchor on FY_START so
 *  this matches every other dashboard's idea of "the year". */
export async function fyMonthlySeries(): Promise<MonthlyRow[]> {
  // Pre-build the 12 buckets in FY order.
  const buckets: MonthlyRow[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(FY_START.getUTCFullYear(), FY_START.getUTCMonth() + i, 1));
    buckets.push({
      month: MONTH_LABELS[i],
      date: d,
      revenue: 0,
      expense: 0,
      net: 0,
      enrollments: 0,
    });
  }

  const [txRows, closeRows] = await Promise.all([
    safe(
      "transaction.groupBy(monthly)",
      () =>
        prisma.transaction.groupBy({
          by: ["month", "type"],
          where: {
            deletedAt: null,
            date: { gte: FY_START, lt: FY_END },
          },
          _sum: { amount: true },
        }),
      [] as Array<{ month: string; type: string; _sum: { amount: { toString(): string } | null } }>,
    ),
    safe(
      "leadPulseDailyClose.findMany(enrollments)",
      () =>
        prisma.leadPulseDailyClose.findMany({
          where: {
            entry: { entryDate: { gte: FY_START, lt: FY_END } },
          },
          select: { entry: { select: { entryDate: true } } },
        }),
      [] as Array<{ entry: { entryDate: Date } }>,
    ),
  ]);

  const byMonth = new Map(buckets.map((b) => [b.month, b]));
  for (const r of txRows) {
    const b = byMonth.get(r.month);
    if (!b) continue;
    const v = num(r._sum.amount);
    if (r.type === "Revenue") b.revenue += v;
    else if (r.type === "Expense") b.expense += v;
    b.net = b.revenue - b.expense;
  }
  for (const c of closeRows) {
    const label = monthLabel(c.entry.entryDate);
    const b = byMonth.get(label);
    if (b) b.enrollments += 1;
  }

  return buckets;
}

export type Forecast = {
  /** Number of completed months used as the base for the projection
   *  (months with any revenue activity, up to but excluding the running month). */
  completedMonths: number;
  /** Average revenue per completed month. */
  avgMonthlyRevenue: number;
  /** Average enrollments per completed month. */
  avgMonthlyEnrollments: number;
  /** Sum of revenue already realised across the FY (all months including current). */
  ytdRevenue: number;
  /** Sum of enrollments YTD. */
  ytdEnrollments: number;
  /** Months remaining after the current month (excluded so the current month's
   *  partial figures don't taint the run-rate). */
  monthsRemaining: number;
  /** Projected total for the full FY = YTD + avg × remaining months. */
  projectedFyRevenue: number;
  projectedFyEnrollments: number;
};

/** Linear "trailing average" projection: take complete months (closed
 *  months only), average them, project forward over the remaining
 *  full months in the FY. Conservative on purpose — no seasonality
 *  assumption. */
export function forecastFromSeries(series: MonthlyRow[]): Forecast {
  const now = new Date();
  const currentMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Completed = months strictly before the current calendar month, that fall
  // within the FY window, and that had at least some activity.
  const completed = series.filter(
    (b) => b.date < currentMonthDate && b.date >= FY_START && (b.revenue > 0 || b.enrollments > 0),
  );

  const completedMonths = completed.length;
  const avgMonthlyRevenue =
    completedMonths > 0 ? completed.reduce((s, b) => s + b.revenue, 0) / completedMonths : 0;
  const avgMonthlyEnrollments =
    completedMonths > 0 ? completed.reduce((s, b) => s + b.enrollments, 0) / completedMonths : 0;

  const ytdRevenue = series
    .filter((b) => b.date >= FY_START && b.date <= currentMonthDate)
    .reduce((s, b) => s + b.revenue, 0);
  const ytdEnrollments = series
    .filter((b) => b.date >= FY_START && b.date <= currentMonthDate)
    .reduce((s, b) => s + b.enrollments, 0);

  // Months strictly after the current month, within the FY window.
  const monthsRemaining = series.filter(
    (b) => b.date > currentMonthDate && b.date < FY_END,
  ).length;

  return {
    completedMonths,
    avgMonthlyRevenue,
    avgMonthlyEnrollments,
    ytdRevenue,
    ytdEnrollments,
    monthsRemaining,
    projectedFyRevenue: ytdRevenue + avgMonthlyRevenue * monthsRemaining,
    projectedFyEnrollments:
      ytdEnrollments + Math.round(avgMonthlyEnrollments * monthsRemaining),
  };
}

export type OrgHealth = {
  /** Headcount = active users in the auth table — the operating team. */
  headcount: number;
  /** Marketing roster carved out of headcount via LeadPulseRole.active. */
  marketingHeadcount: number;
  /** Salary spend in the running calendar month (category="Salary" expense). */
  currentMonthPayroll: number;
  /** Salary spend in the previous month, for the trend chip. */
  previousMonthPayroll: number;
  /** YTD salary spend in the running FY. */
  ytdPayroll: number;
  /** Highest-spend expense category YTD. */
  topExpenseCategory: { name: string; value: number } | null;
  /** Funnel conversion across the FY: closed_won / leads. */
  funnelConversionPct: number | null;
  /** Net margin YTD: (revenue - expense) / revenue. */
  netMarginPct: number | null;
  /** Compound "health score" 0-100. */
  healthScore: number;
  healthSummary: string;
};

export async function orgHealth(series: MonthlyRow[]): Promise<OrgHealth> {
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const emptyAgg = { _sum: { amount: null as null | { toString(): string } } };
  const [
    headcount,
    marketingHeadcount,
    currentPayroll,
    previousPayroll,
    ytdPayroll,
    topExpense,
    funnelL1,
    funnelL2,
  ] = await Promise.all([
    safe("user.count", () => prisma.user.count(), 0),
    safe(
      "leadPulseRole.count(active)",
      () => prisma.leadPulseRole.count({ where: { active: true } }),
      0,
    ),
    safe(
      "transaction.aggregate(currentMonthPayroll)",
      () =>
        prisma.transaction.aggregate({
          where: {
            deletedAt: null,
            type: "Expense",
            category: "Salary",
            date: { gte: currentMonthStart, lt: nextMonthStart },
          },
          _sum: { amount: true },
        }),
      emptyAgg,
    ),
    safe(
      "transaction.aggregate(previousMonthPayroll)",
      () =>
        prisma.transaction.aggregate({
          where: {
            deletedAt: null,
            type: "Expense",
            category: "Salary",
            date: { gte: prevMonthStart, lt: currentMonthStart },
          },
          _sum: { amount: true },
        }),
      emptyAgg,
    ),
    safe(
      "transaction.aggregate(ytdPayroll)",
      () =>
        prisma.transaction.aggregate({
          where: {
            deletedAt: null,
            type: "Expense",
            category: "Salary",
            date: { gte: FY_START, lt: FY_END },
          },
          _sum: { amount: true },
        }),
      emptyAgg,
    ),
    safe(
      "transaction.groupBy(topExpense)",
      () =>
        prisma.transaction
          .groupBy({
            by: ["category"],
            where: {
              deletedAt: null,
              type: "Expense",
              date: { gte: FY_START, lt: FY_END },
            },
            _sum: { amount: true },
          })
          .then(
            (rows) =>
              rows
                .map((r) => ({ name: r.category, value: num(r._sum.amount) }))
                .sort((a, b) => b.value - a.value)[0] ?? null,
          ),
      null as { name: string; value: number } | null,
    ),
    safe(
      "leadPulseDailyEntry.aggregate(funnelL1)",
      () =>
        prisma.leadPulseDailyEntry.aggregate({
          where: {
            roleAtEntry: "l1",
            entryDate: { gte: FY_START, lt: FY_END },
            status: "submitted",
          },
          _sum: { leadsReceived: true },
        }),
      { _sum: { leadsReceived: null as number | null } },
    ),
    safe(
      "leadPulseDailyEntry.aggregate(funnelL2)",
      () =>
        prisma.leadPulseDailyEntry.aggregate({
          where: {
            roleAtEntry: "l2",
            entryDate: { gte: FY_START, lt: FY_END },
            status: "submitted",
          },
          _sum: { closedWon: true, receivedFromL1: true, directLeads: true },
        }),
      {
        _sum: {
          closedWon: null as number | null,
          receivedFromL1: null as number | null,
          directLeads: null as number | null,
        },
      },
    ),
  ]);

  const l1Leads = funnelL1._sum.leadsReceived ?? 0;
  const l2Leads = (funnelL2._sum.receivedFromL1 ?? 0) + (funnelL2._sum.directLeads ?? 0);
  const l2Won = funnelL2._sum.closedWon ?? 0;
  // Use the broader leads denominator: prefer L1 leads if any, else L2 leads.
  const denom = l1Leads > 0 ? l1Leads : l2Leads;
  const funnelConversionPct = denom > 0 ? (l2Won / denom) * 100 : null;

  const ytdRevenue = series.reduce((s, b) => s + b.revenue, 0);
  const ytdExpense = series.reduce((s, b) => s + b.expense, 0);
  const netMarginPct = ytdRevenue > 0 ? ((ytdRevenue - ytdExpense) / ytdRevenue) * 100 : null;

  // Health score: blend net margin, conversion %, and pipeline coverage into
  // a 0-100 number. Each band contributes ~33 points; everything clamped.
  const marginPts = netMarginPct === null ? 16 : clamp((netMarginPct / 40) * 33, 0, 33);
  const conversionPts =
    funnelConversionPct === null ? 16 : clamp((funnelConversionPct / 25) * 33, 0, 33);
  // Payroll-vs-revenue rough sustainability check: target salary ≤ 35% of
  // revenue (industry benchmark for services firms).
  const payrollLoad =
    ytdRevenue > 0 ? num(ytdPayroll._sum.amount) / ytdRevenue : 0;
  const payrollPts = clamp((1 - payrollLoad / 0.5) * 34, 0, 34);
  const healthScore = Math.round(marginPts + conversionPts + payrollPts);

  const healthSummary =
    healthScore >= 75
      ? "Healthy"
      : healthScore >= 55
        ? "Stable"
        : healthScore >= 35
          ? "Watch"
          : "At risk";

  return {
    headcount,
    marketingHeadcount,
    currentMonthPayroll: num(currentPayroll._sum.amount),
    previousMonthPayroll: num(previousPayroll._sum.amount),
    ytdPayroll: num(ytdPayroll._sum.amount),
    topExpenseCategory: topExpense,
    funnelConversionPct,
    netMarginPct,
    healthScore,
    healthSummary,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
