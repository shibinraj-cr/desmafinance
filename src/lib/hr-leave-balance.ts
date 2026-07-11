import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
import { cycleMonthForDate, computeLateTags } from "./hr-data";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Loss-of-pay for a single cycle month from its attendance rows:
 *   A (absent) × 1  +  HD (half-day) × 0.5  +  AL (late-beyond-allowance) × 0.5
 * AL is a PRESENT day docked half a day for arriving late past the LCE grace/quota
 * — the salary engine already docks it (see countAlHalfDays), so the ledger must
 * count it too or "Unpaid taken" understates the real deduction. `eligibleLce` is
 * the employee's half-hour concession (LCE eligibility). The LCE quota resets per
 * cycle month, so this must be called on one month's rows at a time.
 */
export function cycleMonthLop(
  days: { id: string; date: Date; status: string; lateMinutes: number | null }[],
  eligibleLce: boolean,
): number {
  let a = 0;
  let hd = 0;
  for (const d of days) {
    if (d.status === "A") a++;
    else if (d.status === "HD") hd++;
  }
  const { tags } = computeLateTags(days, eligibleLce);
  let al = 0;
  for (const d of days) if (d.status === "P" && tags.get(d.id) === "AL") al++;
  return round2(a + hd * 0.5 + al * 0.5);
}

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

/**
 * The SALARY-CYCLE months (1–12) of `year` that receive the monthly accrual,
 * keyed by cycle month (26th → 25th) rather than calendar month. This is the
 * correct basis for the ledger and balance carry-forward: an eligibility that
 * starts on a cycle boundary (e.g. effectiveFrom 26-Mar → the April cycle)
 * must credit the April cycle, not "March". `accrualMonthsInYear` keys by
 * calendar month and is off by one for such boundary dates.
 */
export function accrualCycleMonthsInYear(year: number, effectiveFrom: Date, asOf: Date): number[] {
  const [effY, effM] = cycleMonthForDate(effectiveFrom).split("-").map(Number);
  if (effY > year) return [];
  const firstMonth = effY < year ? 1 : effM;
  const [nowY, nowM] = cycleMonthForDate(asOf).split("-").map(Number);
  const lastMonth = year > nowY ? 0 : year < nowY ? 12 : nowM;
  const months: number[] = [];
  for (let m = firstMonth; m <= lastMonth; m++) months.push(m);
  return months;
}

export type LeaveLedgerRow = {
  month: number; // 1–12 (salary-cycle month index within the year)
  label: string; // e.g. "Apr-2026"
  allocated: number; // paid-leave allocation for the month (HR override, else eligibility)
  accrued: number; // allocated + manual ledger adjustments that month
  taken: number; // paid leave taken that month = explicit LV + paid-leave coverage of LOP
  covered: number; // portion of `taken` that covered loss-of-pay (A/HD/AL) via the allocation
  unpaid: number; // loss-of-pay NOT covered by paid leave (LOP − covered)
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

  const [eligibility, existing, ledger, days, employee] = await Promise.all([
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
    // ALL attendance in the window (not just LV/HD/A): AL half-days are docked on
    // PRESENT rows, so late minutes on P days are needed to compute the true LOP.
    prisma.hrAttendanceDay.findMany({
      where: { employeeId, date: { gte: windowStart, lte: windowEnd } },
      select: { id: true, date: true, status: true, lateMinutes: true },
    }),
    prisma.employee.findUnique({ where: { id: employeeId }, select: { halfHourConcession: true } }),
  ]);

  const opening = existing ? Number(existing.opening) : 0;
  const perMonthRate =
    eligibility && eligibility.enabled ? Number(eligibility.leavesPerPeriod) : 0;
  const accrualMonths = new Set(
    eligibility && eligibility.enabled
      ? accrualCycleMonthsInYear(year, eligibility.effectiveFrom, asOf)
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

  // Bucket every day by cycle month, then compute that month's loss-of-pay
  // (A + HD·0.5 + AL·0.5) and any explicit full-day paid leave (LV).
  const eligibleLce = employee?.halfHourConcession ?? false;
  const daysByMonth = new Map<number, typeof days>();
  const lvByMonth = new Map<number, number>();
  for (const d of days) {
    const m = Number(cycleMonthForDate(d.date).split("-")[1]);
    if (m < 1 || m > 12) continue;
    if (!daysByMonth.has(m)) daysByMonth.set(m, []);
    daysByMonth.get(m)!.push(d);
    if (d.status === "LV") lvByMonth.set(m, (lvByMonth.get(m) ?? 0) + 1);
  }
  const lopByMonth = new Map<number, number>();
  for (const [m, mdays] of daysByMonth) lopByMonth.set(m, cycleMonthLop(mdays, eligibleLce));

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
    const lv = lvByMonth.get(m) ?? 0;
    const lop = lopByMonth.get(m) ?? 0;
    // Credit the month's accrual, then let the balance cover leave in priority
    // order: explicit full-day paid leave (LV) first, then loss-of-pay
    // (absence / half-day / late) up to whatever balance remains. Carry-forward:
    // unused balance rolls into the next month.
    balance = round2(balance + accrued - lv);
    const covered = Math.min(Math.max(0, balance), lop);
    balance = round2(balance - covered);
    const taken = round2(lv + covered);
    const unpaid = round2(lop - covered);
    if (m === currentMonth) balanceAsOn = balance;
    rows.push({ month: m, label: `${MONTH_LABELS[m - 1]}-${year}`, allocated, accrued, taken, covered, unpaid, balance });
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
  // Cycle-year window (26 Dec prev → 25 Dec) — same basis as the monthly ledger,
  // so the persisted balance agrees with what the ledger shows.
  const windowStart = new Date(Date.UTC(year - 1, 11, 26));
  const windowEnd = new Date(Date.UTC(year, 11, 25));

  const [eligibility, existing, ledger, days, employee] = await Promise.all([
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
    // All attendance in the window: AL (late) half-days are docked on PRESENT
    // rows, so late minutes are needed for the true loss-of-pay.
    db.hrAttendanceDay.findMany({
      where: { employeeId, date: { gte: windowStart, lte: windowEnd } },
      select: { id: true, date: true, status: true, lateMinutes: true },
    }),
    db.employee.findUnique({ where: { id: employeeId }, select: { halfHourConcession: true } }),
  ]);

  // HR's per-month allocation (source 'allocation') overrides the eligibility
  // auto-accrual for that month; a month with no override falls back to the
  // eligibility rate. Manual/expiry ledger adjustments are additive on top.
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
      ? accrualCycleMonthsInYear(year, eligibility.effectiveFrom, asOf)
      : [],
  );
  // Elapsed cycle months in `year` (cycle month of asOf; 0 future / 12 past year).
  const [nowY, nowCycleM] = cycleMonthForDate(asOf).split("-").map(Number);
  const lastElapsed = year > nowY ? 0 : year < nowY ? 12 : nowCycleM;

  // Per-cycle-month loss-of-pay (A + HD·0.5 + AL·0.5) and full-day paid leave (LV).
  const eligibleLce = employee?.halfHourConcession ?? false;
  const daysByMonth = new Map<number, typeof days>();
  const lvByMonth = new Map<number, number>();
  for (const d of days) {
    const m = Number(cycleMonthForDate(d.date).split("-")[1]);
    if (m < 1 || m > 12) continue;
    if (!daysByMonth.has(m)) daysByMonth.set(m, []);
    daysByMonth.get(m)!.push(d);
    if (d.status === "LV") lvByMonth.set(m, (lvByMonth.get(m) ?? 0) + 1);
  }
  const lopByMonth = new Map<number, number>();
  for (const [m, mdays] of daysByMonth) lopByMonth.set(m, cycleMonthLop(mdays, eligibleLce));

  // Paid leave used = full-day paid leave (LV) + paid-leave coverage of
  // loss-of-pay, applied month-by-month with carry-forward — the monthly
  // allocation covers the earliest absence / half-day / late-day up to the
  // balance available. A HD/AL is NOT charged in full: only the covered portion
  // (via the allocation) consumes the balance; the rest stays plain loss-of-pay.
  const opening = existing ? Number(existing.opening) : 0;
  let entitlement = 0;
  let used = 0;
  let balance = round2(opening + manualSum); // manual adjustments available up front
  for (let m = 1; m <= lastElapsed; m++) {
    const alloc = overrideByMonth.has(m)
      ? (overrideByMonth.get(m) ?? 0)
      : accrualSet.has(m)
        ? perMonthRate
        : 0;
    entitlement += alloc;
    const lv = lvByMonth.get(m) ?? 0;
    const lop = lopByMonth.get(m) ?? 0;
    balance = round2(balance + alloc - lv);
    const covered = Math.min(Math.max(0, balance), lop);
    balance = round2(balance - covered);
    used = round2(used + lv + covered);
  }
  const accrued = round2(entitlement + manualSum);
  return { opening, accrued, used, balance: round2(opening + accrued - used) };
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
