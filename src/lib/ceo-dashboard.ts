// CEO Dashboard — cross-module rollup combining Finance (Transactions,
// Collection Plans), Marketing (CRM enrollments) and HR
// (User roster + Salary expense category) into one screen.
//
// All numbers are sourced from the same tables the per-module pages use,
// so the CEO view never drifts from what Finance / Marketing dashboards
// show.

import { prisma } from "./prisma";
import { FY_START, FY_END, MONTH_LABELS } from "./period";
import { getMetricsSource } from "./lead-pulse-crm-metrics";
import { effectiveDesignation, isOwnerDesignation } from "./hr-salary-engine";

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

  /** CRM pipeline — leads sitting in the CRM "Pipeline" stage (put there by
   *  "Set deal"), valued at the deal's expected value and bucketed by its
   *  expected close date. Shown for information only; NOT part of the
   *  Forecast. Field names are kept from the retired Lead Pulse pipeline
   *  tiles so older mobile builds keep reading them. */
  /** Pipeline leads expected to close in the running calendar month. */
  pipelineValue: number;
  pipelineCount: number;
  /** Pipeline leads expected to close after the running month. */
  pipelineValueBeyond: number;
  pipelineCountBeyond: number;
  /** Pipeline leads whose close date has already passed (or was never set) —
   *  in neither tile, surfaced so they get re-dated, enrolled or dropped. */
  pipelineOverdueValue: number;
  pipelineOverdueCount: number;
  /** Id of the CRM "Pipeline" stage, for linking to the filtered Leads list. */
  pipelineStageId: string | null;

  /** Finance approval queue — distinct from collection plans. Surfaced so the
   *  CEO can see if any reviews are stuck. */
  pendingApprovalsCount: number;

  /** Sum of unsubmitted TransactionDraft.amount (across all users) of
   *  type Revenue dated in the running calendar month — revenue captured
   *  on the My Drafts workflow but not yet pushed to the approval queue. */
  myDraftsRevenue: number;
  myDraftsRevenueCount: number;

  /** Sum of pending-approval (kind='create', status='pending') proposed
   *  Revenue amounts, WHATEVER their date — every new revenue entry on
   *  Finance → Approvals → Pending (Revenue) awaiting a manager/admin. Counted
   *  into this month's Forecast as money already in hand. Pending edits and
   *  deletes are left out: an edit's amount is already in revenue. */
  pendingApprovalRevenue: number;
  pendingApprovalRevenueCount: number;
  /** The part of pendingApprovalRevenue dated outside the running month
   *  (once approved it posts to that month, not this one). */
  pendingApprovalRevenueOtherMonths: number;
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

type PipelineBucket = { value: number; count: number };

/**
 * Split CRM Pipeline-stage leads by expected close date: this month, later
 * months, or overdue (date passed or never set). `@db.Date` close dates are
 * midnight UTC, matching the UTC month bounds used across this file.
 */
export function bucketPipeline(
  leads: Array<{ expectedValue: { toString(): string } | number | null; expectedCloseDate: Date | null }>,
  monthStart: Date,
  nextMonthStart: Date,
): { current: PipelineBucket; beyond: PipelineBucket; overdue: PipelineBucket } {
  const out = {
    current: { value: 0, count: 0 },
    beyond: { value: 0, count: 0 },
    overdue: { value: 0, count: 0 },
  };
  for (const l of leads) {
    const d = l.expectedCloseDate;
    const b =
      d && d >= nextMonthStart ? out.beyond : d && d >= monthStart ? out.current : out.overdue;
    b.value += num(l.expectedValue);
    b.count += 1;
  }
  return out;
}

export async function ceoHeadline(): Promise<CeoHeadline> {
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const [cur, prev, plans, approvals, drafts, pendingApprovalRows, pipelineStage, pipelineLeads] =
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
    // by type below). The queue is small, so this is cheap.
    safe(
      "pendingApproval.findMany(pendingApprovalRevenue)",
      () =>
        prisma.pendingApproval.findMany({
          where: { status: "pending", kind: "create" },
          select: { proposed: true },
        }),
      [] as Array<{ proposed: unknown }>,
    ),
    safe(
      "crmLeadStatus.findFirst(pipeline)",
      () => prisma.crmLeadStatus.findFirst({ where: { code: "pipeline" }, select: { id: true } }),
      null as { id: string } | null,
    ),
    // Every lead currently in the CRM Pipeline stage with its deal. Bucketed
    // in JS so a lead with no close date still lands somewhere (overdue).
    safe(
      "lead.findMany(crmPipeline)",
      () =>
        prisma.lead.findMany({
          where: { status: { code: "pipeline" } },
          select: { expectedValue: true, expectedCloseDate: true },
        }),
      [] as Array<{ expectedValue: { toString(): string } | null; expectedCloseDate: Date | null }>,
    ),
  ]);

  const currentMonthRevenue = num(cur._sum.amount);
  const previousMonthRevenue = num(prev._sum.amount);
  const currentMonthRevenueTrendPct =
    previousMonthRevenue > 0
      ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
      : null;
  const expectedCollections = num(plans._sum.amount);
  const pipeline = bucketPipeline(pipelineLeads, currentMonthStart, nextMonthStart);
  const myDraftsRevenue = num(drafts._sum.amount);

  // Sum every proposed Revenue amount sitting in the pending-approval queue —
  // the same rows Finance → Approvals → Pending lists under Revenue, whatever
  // their date — noting how much of it is dated outside this month.
  let pendingApprovalRevenue = 0;
  let pendingApprovalRevenueCount = 0;
  let pendingApprovalRevenueOtherMonths = 0;
  for (const row of pendingApprovalRows) {
    const p = row.proposed as { type?: string; amount?: number; date?: string } | null;
    if (!p || p.type !== "Revenue") continue;
    const amount = num(p.amount);
    pendingApprovalRevenue += amount;
    pendingApprovalRevenueCount += 1;
    const when = p.date ? new Date(p.date) : null;
    if (!when || isNaN(when.getTime()) || when < currentMonthStart || when >= nextMonthStart) {
      pendingApprovalRevenueOtherMonths += amount;
    }
  }

  return {
    currentMonthLabel: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
    currentMonthRevenue,
    previousMonthRevenue,
    currentMonthRevenueTrendPct,
    expectedCollections,
    expectedCollectionsCount: plans._count._all,
    pipelineValue: pipeline.current.value,
    pipelineCount: pipeline.current.count,
    pipelineValueBeyond: pipeline.beyond.value,
    pipelineCountBeyond: pipeline.beyond.count,
    pipelineOverdueValue: pipeline.overdue.value,
    pipelineOverdueCount: pipeline.overdue.count,
    pipelineStageId: pipelineStage?.id ?? null,
    pendingApprovalsCount: approvals,
    myDraftsRevenue,
    myDraftsRevenueCount: drafts._count._all,
    pendingApprovalRevenue,
    pendingApprovalRevenueCount,
    pendingApprovalRevenueOtherMonths,
  };
}

export type ProfitRow = {
  date: Date;
  type: string;
  category: string;
  subItem: string;
  amount: number;
  /** Designation of the employee the row pays, when it pays one. */
  employeeDesignation?: string | null;
};

/** One period's Total Income − Expenses, with Director's Salary on its own line. */
export type ProfitStatement = {
  income: number;
  /** Every expense except Director's Salary. */
  expenses: number;
  /** income − expenses. */
  profit: number;
  directorSalary: number;
  /** profit − directorSalary: all revenue less all expense, i.e. the "Net"
   *  charted on the dashboard. */
  profitAfterDirectorSalary: number;
};

export type CeoProfit = {
  /** The running calendar month, same bounds as the revenue tile. */
  month: ProfitStatement;
  /** The fiscal year so far. */
  ytd: ProfitStatement;
};

/**
 * Is this ledger row a Director's pay? It can read three ways, because
 * Transaction stores category/subItem as strings that were never rewritten
 * when the Expense master changed on 8 May 2026:
 *   - Salary → Directors, today's catalog entry;
 *   - a top-level "Directors" category, the catalog before that date;
 *   - any other Salary sub-item paid to an MD / Director employee.
 */
export function isDirectorSalary(r: ProfitRow): boolean {
  if (r.type !== "Expense") return false;
  const category = r.category.trim().toLowerCase();
  if (category === "directors") return true;
  if (category !== "salary") return false;
  return r.subItem.trim().toLowerCase() === "directors" || isOwnerDesignation(r.employeeDesignation);
}

/** Sum the ledger rows dated in [from, to) into one profit statement. */
export function buildProfitStatement(rows: ProfitRow[], from: Date, to: Date): ProfitStatement {
  let income = 0;
  let expenses = 0;
  let directorSalary = 0;
  for (const r of rows) {
    if (r.date < from || r.date >= to) continue;
    if (r.type === "Revenue") income += r.amount;
    else if (isDirectorSalary(r)) directorSalary += r.amount;
    else if (r.type === "Expense") expenses += r.amount;
  }
  const profit = income - expenses;
  return {
    income,
    expenses,
    profit,
    directorSalary,
    profitAfterDirectorSalary: profit - directorSalary,
  };
}

/** Profit for the running month and the fiscal year so far. Reads row by row
 *  because telling a Director's pay apart needs the employee's designation. */
export async function ceoProfit(): Promise<CeoProfit> {
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const rows = await safe(
    "transaction.findMany(profit)",
    () =>
      prisma.transaction.findMany({
        where: { deletedAt: null, date: { gte: FY_START } },
        select: {
          date: true,
          type: true,
          category: true,
          subItem: true,
          amount: true,
          employee: { select: { designation: true, designationRef: { select: { name: true } } } },
        },
      }),
    [],
  );

  const profitRows: ProfitRow[] = rows.map((r) => ({
    date: r.date,
    type: r.type,
    category: r.category,
    subItem: r.subItem,
    amount: num(r.amount),
    employeeDesignation: r.employee ? effectiveDesignation(r.employee) : null,
  }));

  return {
    month: buildProfitStatement(profitRows, currentMonthStart, nextMonthStart),
    ytd: buildProfitStatement(profitRows, FY_START, FY_END),
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
  /** Enrollments landing in the month, sourced from whichever feed the live
   *  Lead Pulse dashboards use (see `getMetricsSource`):
   *    - "crm"         → closed_won LeadPulsePipeline rows, bucketed by closedDate
   *    - "daily_entry" → LeadPulseDailyClose rows, bucketed by entry.entryDate
   *  Reading the same source keeps this chart in lockstep with Marketing. */
  enrollments: number;
};

/** Authoritative enrollment totals for the pre-CRM-cutover months. Enrollments
 *  used to be tracked on the manual daily entry, so per-enrollment closed_won
 *  pipelines don't exist (April) or are only partial (May: 21 pipelines vs the
 *  true 60) for these months — a live CRM count under-reports them. These frozen
 *  totals come from the marketing enrollment records (the same source that
 *  reconciled June to 59). Only applied to months that have already ended, so the
 *  current + future months keep flowing live from CRM and self-correct.
 *  See [[june2026-enrollment-reconciliation]]. */
const HISTORICAL_ENROLLMENTS: Record<string, number> = {
  "Apr-26": 47,
  "May-26": 60,
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

  // Enrollments must come from the SAME feed the live Lead Pulse dashboards
  // read, or the CEO chart drifts from Marketing. Post-CRM-cutover the flag is
  // "crm": count closed_won pipelines by closedDate (matches getCrmFunnel).
  // Pre-cutover / rollback it's "daily_entry": count LeadPulseDailyClose rows.
  const metricsSource = await safe("getMetricsSource", () => getMetricsSource(), "daily_entry");

  const [txRows, enrollmentDates] = await Promise.all([
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
    metricsSource === "crm"
      ? safe(
          "leadPulsePipeline.findMany(enrollments)",
          () =>
            prisma.leadPulsePipeline
              .findMany({
                where: { status: "closed_won", closedDate: { gte: FY_START, lt: FY_END } },
                select: { closedDate: true },
              })
              // closedDate can't be null here (the range filter excludes nulls),
              // but narrow the type for the bucketer below.
              .then((rows) => rows.map((r) => r.closedDate).filter((d): d is Date => d !== null)),
          [] as Date[],
        )
      : safe(
          "leadPulseDailyClose.findMany(enrollments)",
          () =>
            prisma.leadPulseDailyClose
              .findMany({
                where: { entry: { entryDate: { gte: FY_START, lt: FY_END } } },
                select: { entry: { select: { entryDate: true } } },
              })
              .then((rows) => rows.map((r) => r.entry.entryDate)),
          [] as Date[],
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
  for (const d of enrollmentDates) {
    const b = byMonth.get(monthLabel(d));
    if (b) b.enrollments += 1;
  }

  // Overlay the authoritative pre-cutover totals, but only for months that have
  // already closed — never freeze the running/future month, which must keep
  // counting live CRM enrollments.
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (const b of buckets) {
    const override = HISTORICAL_ENROLLMENTS[b.month];
    if (override !== undefined && b.date < currentMonthStart) {
      b.enrollments = override;
    }
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

  // Health score: blend net margin, conversion % and payroll load into a
  // 0-100 number. Each band contributes ~33 points; everything clamped.
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
