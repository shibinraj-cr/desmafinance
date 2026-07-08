import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
import { cycleMonthForDate } from "./hr-data";

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
 *   - accrued = per-employee entitlement-to-date for the year — HR's per-month
 *               allocation (HrLeaveAccrual source 'allocation') where set, else
 *               the eligibility auto-accrual (`leavesPerPeriod`) for that month,
 *               summed over elapsed months + manual ledger adjustments
 *               (HrLeaveAccrual source 'manual' / 'expiry'),
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
  month: number; // 1–12 (salary-cycle month index within the year)
  label: string; // e.g. "Apr-2026"
  allocated: number; // paid-leave allocation for the month (HR override, else eligibility)
  accrued: number; // allocated + manual ledger adjustments that month
  taken: number; // full-day paid leave taken that month (LV = 1)
  unpaid: number; // loss-of-pay that month (A = 1, HD = 0.5)
  balance: number; // running carry-forward balance after this month
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Month-wise leave ledger for `year`, keyed by **salary-cycle month** (26th of
 * the previous month → 25th; see `cycleMonthForDate`). Each row is one cycle
 * month `MMM-YYYY`: paid leave credited, paid leave taken, unpaid (absence /
 * half-day) days, and the running carry-forward balance. Read-only derivation
 * over the canonical sources — HR's per-month allocation override
 * (`HrLeaveAccrual` source 'allocation') where present, else the eligibility
 * auto-accrual, plus the manual ledger and decided attendance.
 *
 * `fill` controls the row window:
 *   - 'toCurrent' (default) — rows through the current cycle month only
 *     (past year → all 12; future year → none). Used by the self-service view.
 *   - 'full' — always the 12 cycle months of `year`; months after the current
 *     one carry taken/unpaid = 0. Used by the HR editable table.
 *
 * `balanceAsOn` is the running balance at the current cycle month (opening for a
 * future year, the year-end balance for a past year) — the "balance as on the
 * current month" headline, unaffected by any future-month pre-allocation.
 */
export async function computeMonthlyLeaveLedger(
  employeeId: string,
  year: number,
  opts: { asOf?: Date; fill?: "toCurrent" | "full" } = {},
): Promise<{
  rows: LeaveLedgerRow[];
  opening: number;
  balanceAsOn: number;
  currentMonth: number; // cycle-month index of `asOf` within `year`: 0 = future year, 12 = past year
}> {
  const asOf = opts.asOf ?? new Date();
  const fill = opts.fill ?? "toCurrent";
  // Cycle-year window: Jan's cycle opens on 26 Dec of the previous year, Dec's
  // closes on 25 Dec of `year`. Every day in this window maps to a cycle month
  // keyed `${year}-01`..`${year}-12`.
  const windowStart = new Date(Date.UTC(year - 1, 11, 26));
  const windowEnd = new Date(Date.UTC(year, 11, 25));

  const [eligibility, existing, ledger, days] = await Promise.all([
    prisma.hrLeaveEligibility.findUnique({ where: { employeeId } }),
    prisma.hrLeaveBalance.findUnique({ where: { employeeId_year: { employeeId, year } } }),
    prisma.hrLeaveAccrual.findMany({
      where: {
        employeeId,
        source: { in: ["manual", "expiry", "allocation"] },
        periodKey: { startsWith: `${year}-` },
      },
      select: { periodKey: true, delta: true, source: true },
    }),
    prisma.hrAttendanceDay.findMany({
      where: { employeeId, date: { gte: windowStart, lte: windowEnd }, status: { in: ["LV", "HD", "A"] } },
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
  const overrideByMonth = new Map<number, number>();
  for (const a of ledger) {
    const m = Number(a.periodKey.split("-")[1]);
    if (m < 1 || m > 12) continue;
    if (a.source === "allocation") overrideByMonth.set(m, Number(a.delta));
    else manualByMonth.set(m, (manualByMonth.get(m) ?? 0) + Number(a.delta));
  }

  const takenByMonth = new Map<number, number>();
  const unpaidByMonth = new Map<number, number>();
  for (const d of days) {
    const m = Number(cycleMonthForDate(d.date).split("-")[1]);
    // Only full-day paid leave (LV) consumes the balance ("taken"). A half-day
    // (HD) is 0.5-day loss-of-pay and an absence (A) a full day — both unpaid.
    if (d.status === "LV") takenByMonth.set(m, (takenByMonth.get(m) ?? 0) + 1);
    else if (d.status === "HD") unpaidByMonth.set(m, (unpaidByMonth.get(m) ?? 0) + 0.5);
    else if (d.status === "A") unpaidByMonth.set(m, (unpaidByMonth.get(m) ?? 0) + 1);
  }

  // Current cycle month within `year`: 0 = future year (nothing elapsed),
  // 12 = past year (fully elapsed).
  const [nowY, nowM] = cycleMonthForDate(asOf).split("-").map(Number);
  const currentMonth = year < nowY ? 12 : year > nowY ? 0 : nowM;
  const lastMonth = fill === "full" ? 12 : currentMonth;

  const rows: LeaveLedgerRow[] = [];
  let balance = opening;
  let balanceAsOn = opening;
  for (let m = 1; m <= lastMonth; m++) {
    const allocated = overrideByMonth.has(m)
      ? (overrideByMonth.get(m) ?? 0)
      : accrualMonths.has(m)
        ? perMonthRate
        : 0;
    const accrued = allocated + (manualByMonth.get(m) ?? 0);
    const taken = takenByMonth.get(m) ?? 0;
    const unpaid = unpaidByMonth.get(m) ?? 0;
    balance = Math.round((balance + accrued - taken) * 100) / 100;
    if (m === currentMonth) balanceAsOn = balance;
    rows.push({ month: m, label: `${MONTH_LABELS[m - 1]}-${year}`, allocated, accrued, taken, unpaid, balance });
  }
  return { rows, opening, balanceAsOn, currentMonth };
}

/**
 * Calendar years to offer in the Leave-tab year filter: every year the
 * employee holds a balance row for, plus last/this/next year (so a fresh
 * employee still has a sensible range and HR can pre-allocate ahead), sorted
 * newest first.
 */
export async function leaveLedgerYears(
  employeeId: string,
  asOf: Date = new Date(),
): Promise<number[]> {
  const bals = await prisma.hrLeaveBalance.findMany({
    where: { employeeId },
    select: { year: true },
  });
  const cur = asOf.getUTCFullYear();
  const years = new Set<number>([cur - 1, cur, cur + 1]);
  for (const b of bals) years.add(b.year);
  return [...years].sort((a, b) => b - a);
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

  const [eligibility, existing, ledger, leaveDays] = await Promise.all([
    db.hrLeaveEligibility.findUnique({ where: { employeeId } }),
    db.hrLeaveBalance.findUnique({ where: { employeeId_year: { employeeId, year } } }),
    db.hrLeaveAccrual.findMany({
      where: {
        employeeId,
        source: { in: ["manual", "expiry", "allocation"] },
        periodKey: { startsWith: `${year}-` },
      },
      select: { periodKey: true, delta: true, source: true },
    }),
    db.hrAttendanceDay.groupBy({
      by: ["status"],
      where: { employeeId, date: { gte: yearStart, lte: yearEnd }, status: { in: ["LV"] } },
      _count: { _all: true },
    }),
  ]);

  // HR's per-month allocation (source 'allocation') overrides the eligibility
  // auto-accrual for that month; a month with no override falls back to the
  // eligibility rate. Manual/expiry ledger adjustments are additive on top.
  // Keyed by calendar year here (matching `used`) so the persisted balance —
  // which the salary run covers LV against — stays calendar-year.
  const overrideByMonth = new Map<number, number>();
  let manualSum = 0;
  for (const a of ledger) {
    if (a.source === "allocation") {
      const m = Number(a.periodKey.split("-")[1]);
      if (m >= 1 && m <= 12) overrideByMonth.set(m, Number(a.delta));
    } else {
      manualSum += Number(a.delta);
    }
  }
  const perMonthRate =
    eligibility && eligibility.enabled ? Number(eligibility.leavesPerPeriod) : 0;
  const accrualSet = new Set(
    eligibility && eligibility.enabled
      ? accrualMonthsInYear(year, eligibility.effectiveFrom, asOf)
      : [],
  );
  const curYear = asOf.getUTCFullYear();
  const lastElapsed = year > curYear ? 0 : year < curYear ? 12 : asOf.getUTCMonth() + 1;
  let entitlement = 0;
  for (let m = 1; m <= lastElapsed; m++) {
    entitlement += overrideByMonth.has(m)
      ? (overrideByMonth.get(m) ?? 0)
      : accrualSet.has(m)
        ? perMonthRate
        : 0;
  }
  const accrued = entitlement + manualSum;

  // Paid leave used = full-day paid leave (LV) only. Half-days (HD) are NOT
  // charged to the leave balance — a HD is simply 0.5-day loss-of-pay in the
  // salary run (it does not consume paid-leave credit). Counting it here too
  // double-penalised the employee (0.5 pay AND 0.5 balance).
  let used = 0;
  for (const g of leaveDays) {
    if (g.status === "LV") used += g._count._all;
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
