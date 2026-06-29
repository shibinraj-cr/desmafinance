import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

/**
 * Canonical leave-balance engine.
 *
 * The stored `HrLeaveBalance` row (opening / accrued / used / balance) used to
 * be written by three drifting paths — the global-policy `accrueMonth` on
 * attendance upload, the eligibility-based `runMonthlyAccrual` job, and
 * `manualAdjustment` — while *decided attendance leave never touched it*
 * (only approved leave requests did). That left balances that ignored both
 * per-employee eligibility and the leave HR actually reviewed and decided.
 *
 * This module is the single source of truth. `recomputeLeaveBalance` derives:
 *   - accrued = per-employee eligibility entitlement-to-date for the year
 *               (`leavesPerPeriod` × elapsed accrual months) + manual ledger
 *               adjustments (HrLeaveAccrual source 'manual' / 'expiry'),
 *   - used    = reviewed & decided paid leave in the calendar year, counting
 *               LV days as 1.0 and HD (half-day) as 0.5,
 *   - balance = opening + accrued − used,
 * and persists it. Every write path that can change eligibility, a leave
 * decision, or an accrual now funnels through here, so all readers
 * (Leave Balances, employee profile, salary run, self-service) stay in sync.
 */

// PrismaClient or an interactive-transaction client — `prisma` is assignable
// to TransactionClient (it's a superset), so callers can pass either.
type Db = Prisma.TransactionClient;

export interface ComputedBalance {
  opening: number;
  accrued: number;
  used: number;
  balance: number;
}

/**
 * Number of monthly accrual periods that have elapsed for `year`, given the
 * eligibility `effectiveFrom` date, as of `asOf`. Each *started* month counts
 * in full — matching `runMonthlyAccrual`, which credits the whole period, and
 * the legacy `monthlyAccrual × month` seeding.
 */
export function elapsedAccrualMonths(year: number, effectiveFrom: Date, asOf: Date): number {
  const effYear = effectiveFrom.getUTCFullYear();
  if (effYear > year) return 0;
  const firstMonth = effYear < year ? 1 : effectiveFrom.getUTCMonth() + 1; // 1..12
  const curYear = asOf.getUTCFullYear();
  let lastMonth: number;
  if (year > curYear) lastMonth = 0; // future year — nothing accrued yet
  else if (year < curYear) lastMonth = 12; // past year — fully accrued
  else lastMonth = asOf.getUTCMonth() + 1; // current year — up to this month
  return Math.max(0, lastMonth - firstMonth + 1);
}

/**
 * The calendar months (1–12) of `year` that receive the standard monthly
 * accrual, given the eligibility `effectiveFrom` and `asOf`. Same window as
 * `elapsedAccrualMonths`, but returns the months rather than the count.
 */
export function accrualMonthsInYear(year: number, effectiveFrom: Date, asOf: Date): number[] {
  const effYear = effectiveFrom.getUTCFullYear();
  if (effYear > year) return [];
  const firstMonth = effYear < year ? 1 : effectiveFrom.getUTCMonth() + 1;
  const curYear = asOf.getUTCFullYear();
  let lastMonth: number;
  if (year > curYear) lastMonth = 0;
  else if (year < curYear) lastMonth = 12;
  else lastMonth = asOf.getUTCMonth() + 1;
  const months: number[] = [];
  for (let m = firstMonth; m <= lastMonth; m++) months.push(m);
  return months;
}

export type LeaveLedgerRow = {
  month: number; // 1–12
  label: string; // e.g. "Apr 2026"
  accrued: number; // paid leave credited that month
  taken: number; // paid leave used that month (LV = 1, HD = 0.5)
  unpaid: number; // absences / loss-of-pay that month (A days)
  balance: number; // running carry-forward balance after this month
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Employee-facing month-wise leave ledger for `year`: paid leave credited,
 * leave taken, unpaid (absence) days, and the running carry-forward balance.
 * Read-only derivation over the canonical sources (eligibility accrual + manual
 * ledger + decided attendance). Months after `asOf` are omitted.
 */
export async function computeMonthlyLeaveLedger(
  employeeId: string,
  year: number,
  asOf: Date = new Date(),
): Promise<{ rows: LeaveLedgerRow[]; opening: number }> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));

  const [eligibility, existing, manualLedger, days] = await Promise.all([
    prisma.hrLeaveEligibility.findUnique({ where: { employeeId } }),
    prisma.hrLeaveBalance.findUnique({ where: { employeeId_year: { employeeId, year } } }),
    prisma.hrLeaveAccrual.findMany({
      where: { employeeId, source: { in: ["manual", "expiry"] }, periodKey: { startsWith: `${year}-` } },
      select: { periodKey: true, delta: true },
    }),
    prisma.hrAttendanceDay.findMany({
      where: { employeeId, date: { gte: yearStart, lte: yearEnd }, status: { in: ["LV", "HD", "A"] } },
      select: { date: true, status: true },
    }),
  ]);

  const opening = existing ? Number(existing.opening) : 0;
  const perMonthRate =
    eligibility && eligibility.enabled ? Number(eligibility.leavesPerPeriod) : 0;
  const accrualMonths = new Set(
    eligibility && eligibility.enabled
      ? accrualMonthsInYear(year, eligibility.effectiveFrom, asOf)
      : [],
  );

  const manualByMonth = new Map<number, number>();
  for (const a of manualLedger) {
    const m = Number(a.periodKey.split("-")[1]);
    if (m >= 1 && m <= 12) manualByMonth.set(m, (manualByMonth.get(m) ?? 0) + Number(a.delta));
  }

  const takenByMonth = new Map<number, number>();
  const unpaidByMonth = new Map<number, number>();
  for (const d of days) {
    const m = d.date.getUTCMonth() + 1;
    if (d.status === "LV") takenByMonth.set(m, (takenByMonth.get(m) ?? 0) + 1);
    else if (d.status === "HD") takenByMonth.set(m, (takenByMonth.get(m) ?? 0) + 0.5);
    else if (d.status === "A") unpaidByMonth.set(m, (unpaidByMonth.get(m) ?? 0) + 1);
  }

  // Show months from January through the last elapsed month (Dec for past
  // years). The running balance opens from the year's carried-in opening.
  const curYear = asOf.getUTCFullYear();
  const lastMonth = year > curYear ? 0 : year < curYear ? 12 : asOf.getUTCMonth() + 1;
  const rows: LeaveLedgerRow[] = [];
  let balance = opening;
  for (let m = 1; m <= lastMonth; m++) {
    const accrued =
      (accrualMonths.has(m) ? perMonthRate : 0) + (manualByMonth.get(m) ?? 0);
    const taken = takenByMonth.get(m) ?? 0;
    const unpaid = unpaidByMonth.get(m) ?? 0;
    balance = Math.round((balance + accrued - taken) * 100) / 100;
    rows.push({ month: m, label: `${MONTH_LABELS[m - 1]} ${year}`, accrued, taken, unpaid, balance });
  }
  return { rows, opening };
}

/** Derive (but don't persist) the canonical balance for one employee/year. */
export async function computeLeaveBalanceFor(
  db: Db,
  employeeId: string,
  year: number,
  asOf: Date = new Date(),
): Promise<ComputedBalance> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));

  const [eligibility, existing, manualLedger, leaveDays] = await Promise.all([
    db.hrLeaveEligibility.findUnique({ where: { employeeId } }),
    db.hrLeaveBalance.findUnique({ where: { employeeId_year: { employeeId, year } } }),
    db.hrLeaveAccrual.aggregate({
      where: {
        employeeId,
        source: { in: ["manual", "expiry"] },
        periodKey: { startsWith: `${year}-` },
      },
      _sum: { delta: true },
    }),
    db.hrAttendanceDay.groupBy({
      by: ["status"],
      where: { employeeId, date: { gte: yearStart, lte: yearEnd }, status: { in: ["LV", "HD"] } },
      _count: { _all: true },
    }),
  ]);

  const entitlement =
    eligibility && eligibility.enabled
      ? Number(eligibility.leavesPerPeriod) *
        elapsedAccrualMonths(year, eligibility.effectiveFrom, asOf)
      : 0;
  const accrued = entitlement + Number(manualLedger._sum.delta ?? 0);

  // Reviewed & decided paid leave: LV = full day, HD = half day.
  let used = 0;
  for (const g of leaveDays) {
    if (g.status === "LV") used += g._count._all;
    else if (g.status === "HD") used += 0.5 * g._count._all;
  }

  const opening = existing ? Number(existing.opening) : 0;
  const balance = opening + accrued - used;
  return { opening, accrued, used, balance };
}

/**
 * Recompute and persist the canonical balance for one employee/year.
 * Returns the computed figures. To avoid littering the table with empty rows,
 * a fresh employee with nothing to show (no eligibility, no manual ledger, no
 * decided leave, no prior row) is left untouched.
 */
export async function recomputeLeaveBalance(
  employeeId: string,
  year: number,
  opts: { db?: Db; asOf?: Date } = {},
): Promise<ComputedBalance> {
  const db = opts.db ?? prisma;
  const c = await computeLeaveBalanceFor(db, employeeId, year, opts.asOf ?? new Date());

  const existing = await db.hrLeaveBalance.findUnique({
    where: { employeeId_year: { employeeId, year } },
  });
  const isEmpty = c.opening === 0 && c.accrued === 0 && c.used === 0 && c.balance === 0;
  if (!existing && isEmpty) return c;

  await db.hrLeaveBalance.upsert({
    where: { employeeId_year: { employeeId, year } },
    update: { opening: c.opening, accrued: c.accrued, used: c.used, balance: c.balance },
    create: {
      employeeId,
      year,
      opening: c.opening,
      accrued: c.accrued,
      used: c.used,
      balance: c.balance,
    },
  });
  return c;
}

/**
 * Recompute every employee who could plausibly hold a balance for `year` —
 * those with an eligibility row, an existing balance row, or decided leave in
 * the year. Used to refresh the Leave Balances view (and after a bulk import)
 * so the figures reflect current eligibility and the latest leave decisions
 * without waiting on the monthly accrual job.
 */
export async function recomputeAllLeaveBalances(
  year: number,
  asOf: Date = new Date(),
): Promise<number> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));

  const [elig, bals, leaveEmp] = await Promise.all([
    prisma.hrLeaveEligibility.findMany({ select: { employeeId: true } }),
    prisma.hrLeaveBalance.findMany({ where: { year }, select: { employeeId: true } }),
    prisma.hrAttendanceDay.findMany({
      where: { date: { gte: yearStart, lte: yearEnd }, status: { in: ["LV", "HD"] } },
      select: { employeeId: true },
      distinct: ["employeeId"],
    }),
  ]);

  const ids = new Set<string>();
  for (const e of elig) ids.add(e.employeeId);
  for (const b of bals) ids.add(b.employeeId);
  for (const d of leaveEmp) ids.add(d.employeeId);

  for (const id of ids) {
    await recomputeLeaveBalance(id, year, { asOf });
  }
  return ids.size;
}
