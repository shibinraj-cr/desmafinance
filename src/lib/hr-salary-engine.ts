import { prisma } from "./prisma";
import { cycleWindowForMonth, structureForMonth, computeLateTags, type LateTag } from "./hr-data";

/**
 * Salary calculation engine.
 *
 * Inputs (from HrSalaryStructure):
 *   basic, hraPct, conveyancePct, medicalPct, specialPct
 *
 * Derived components (live):
 *   hra        = basic × hraPct%
 *   conveyance = basic × conveyancePct%
 *   medical    = basic × medicalPct%
 *   special    = basic × specialPct%
 *   gross      = basic + hra + conveyance + medical + special
 *                (with default 50/25/35/40 → gross = basic × 2.5)
 *
 * Payroll month math (mirrors the reference Jan–Apr 2026 calc files):
 *   workingDaysBase = 30  (calendar default; editable per run)
 *   dailyBasis      = gross / workingDaysBase
 *   daysAttended    = workingDaysBase − totalLeaveForLop   (paid days)
 *   basicAfterLop   = basic × (daysAttended / workingDaysBase)
 *   salaryBeforeEsi = gross − (dailyBasis × totalLeaveForLop)
 *   ESI employee 0.75% · employer 3.25% on salaryBeforeEsi
 *     (only if esiApplicable AND gross ≤ ₹21,000 statutory ceiling)
 *   PF  employee 12%   · employer 12%   on basicAfterLop   (if pfApplicable)
 *   PT  = professionalTax (flat, set by Kerala slab)
 *   net = salaryBeforeEsi − ESI(E) − PF(E) − PT
 */

/// Company-wide CTC split (effective May 2026 onwards). Each allowance
/// is a % of Basic. Total allowances = 100% → Gross = Basic × 2.
export const DEFAULT_ALLOWANCE_PCTS = {
  hra: 40,
  conveyance: 20,
  medical: 25,
  special: 15,
} as const;

/// Statutory rates. Employer-side ESI was historically 3.25% but DESMA's
/// payroll uses 3.75% (per the May 2026 salary structure sheet).
export const ESI_EMPLOYEE_RATE = 0.0075;
export const ESI_EMPLOYER_RATE = 0.0375;
export const PF_RATE = 0.12;
/// Statutory PF wage ceiling: ₹15,000 of Basic. PF contribution from
/// each side is therefore capped at ₹1,800 / month.
export const PF_WAGE_CEILING = 15000;
export const PF_CONTRIBUTION_CAP = PF_WAGE_CEILING * PF_RATE; // 1800

/**
 * Trainees are paid on BASIC ONLY: no allowances, no ESI, no PF, no PT.
 * Enforced by designation NAME (case-insensitive, trimmed), matched against
 * both the modern HrDesignation relation and the legacy `employee.designation`.
 */
export const TRAINEE_DESIGNATION_NAME = "Trainee";

export function isTraineeDesignation(name?: string | null): boolean {
  return (name ?? "").trim().toLowerCase() === TRAINEE_DESIGNATION_NAME.toLowerCase();
}

/**
 * Company owners (Managing Director / Director). Attendance and leaves do not
 * apply to them: payroll pays their full structured salary every month with
 * zero loss-of-pay, and they are excluded from leave accrual / the attendance
 * grid. Matched by designation NAME (case-insensitive, trimmed) against both
 * the modern HrDesignation relation and the legacy `employee.designation`.
 */
export const OWNER_DESIGNATION_NAMES = ["Managing Director", "Director"] as const;

export function isOwnerDesignation(name?: string | null): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return n !== "" && OWNER_DESIGNATION_NAMES.some((d) => d.toLowerCase() === n);
}

export type SalaryBreakdown = {
  basic: number;
  hra: number;
  conveyance: number;
  medical: number;
  special: number;
  gross: number;
};

export type SalaryCalc = SalaryBreakdown & {
  totalWorkingDays: number;
  daysAttended: number;
  paidLeave: number;
  unpaidLeave: number;
  halfDayLeave: number;
  totalLeaveForLop: number;
  monthlySalary: number; // alias for gross — kept for HrSalaryRunLine column
  basicSalary: number; // alias for basic — kept for HrSalaryRunLine column
  basicAfterLop: number;
  dailyBasis: number;
  salaryBeforeEsi: number;
  esiEmployee: number;
  esiEmployer: number;
  pfEmployee: number;
  pfEmployer: number;
  professionalTax: number;
  netSalary: number;
  esiTotal: number;
  pfTotal: number;
};

const round = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Derive gross + allowance breakdown from basic + percentages. */
export function deriveBreakdown(
  basic: number,
  pcts: { hraPct?: number; conveyancePct?: number; medicalPct?: number; specialPct?: number } = {},
): SalaryBreakdown {
  const hraPct = pcts.hraPct ?? DEFAULT_ALLOWANCE_PCTS.hra;
  const conveyancePct = pcts.conveyancePct ?? DEFAULT_ALLOWANCE_PCTS.conveyance;
  const medicalPct = pcts.medicalPct ?? DEFAULT_ALLOWANCE_PCTS.medical;
  const specialPct = pcts.specialPct ?? DEFAULT_ALLOWANCE_PCTS.special;
  const hra = round2((basic * hraPct) / 100);
  const conveyance = round2((basic * conveyancePct) / 100);
  const medical = round2((basic * medicalPct) / 100);
  const special = round2((basic * specialPct) / 100);
  const gross = round2(basic + hra + conveyance + medical + special);
  return { basic, hra, conveyance, medical, special, gross };
}

/**
 * Kerala Professional Tax slab (half-yearly). The amount shown is per-
 * month (slab total / 6). Source: the user's reference Salary Corrections
 * sheet:
 *   half-yearly 75k–99,999  → ₹750 ÷ 6 = ₹125/mo
 *   half-yearly 100k–124,999 → ₹1000 ÷ 6 ≈ ₹167/mo
 *   half-yearly ≥ 125k       → ₹1250 ÷ 6 ≈ ₹208/mo
 * Below 75k/half-year (i.e. gross < 12,500/mo) we still default to ₹125;
 * HR can override per employee.
 */
export function suggestProfessionalTax(grossMonthly: number): number {
  const halfYear = grossMonthly * 6;
  if (halfYear >= 125_000) return 208;
  if (halfYear >= 100_000) return 167;
  return 125;
}

/** ESI applies when gross ≤ ₹21,000/month. */
export function isEsiApplicable(grossMonthly: number): boolean {
  return grossMonthly <= 21000;
}

export function calcLine(args: {
  workingDaysBase: number;
  basic: number;
  hraPct?: number;
  conveyancePct?: number;
  medicalPct?: number;
  specialPct?: number;
  esiApplicable: boolean;
  pfApplicable: boolean;
  professionalTax: number;
  daysPresent: number;
  daysHalfDay: number;
  daysAbsent: number;
  daysPaidLeave: number;
  carriedBalanceBefore: number;
}): SalaryCalc {
  const wd = args.workingDaysBase;
  const breakdown = deriveBreakdown(args.basic, args);
  const gross = breakdown.gross;
  const dailyBasis = round2(gross / wd);

  const paidCovered = Math.min(args.daysPaidLeave, Math.max(0, args.carriedBalanceBefore));
  const paidUncovered = Math.max(0, args.daysPaidLeave - paidCovered);

  const totalLeaveForLop = round2(args.daysAbsent + paidUncovered + args.daysHalfDay * 0.5);
  // Paid days = working-days base − loss-of-pay. We derive attended days
  // from LOP rather than summing present-marked rows, so the PF base stays
  // consistent with the gross/LOP side: an employee paid the full month
  // (minus explicit LOP) must also accrue PF on the full month. Summing
  // present rows silently understated PF whenever an attendance row was
  // missing or a day was left unmarked — e.g. Greeshma, Apr 2026, whose
  // import was short ~6 present rows, so she accrued PF on 22.5 days while
  // being paid salary for 28.5. (args.daysPresent is intentionally unused;
  // unmarked days count as paid — attendance/leave marking is authoritative.)
  const daysAttended = Math.max(0, round2(wd - totalLeaveForLop));
  const basicAfterLop = round2((args.basic * daysAttended) / wd);
  const salaryBeforeEsi = round2(gross - dailyBasis * totalLeaveForLop);

  // ESI applies only when the structure flag is on AND gross is within the
  // statutory ₹21,000/month ceiling. Enforcing the ceiling here — not just
  // trusting the saved flag — means a stale/incorrect esiApplicable=true on a
  // high earner's structure can never wrongly deduct ESI. (e.g. Devika &
  // Shibin Raj, whose Jan-2026 structures carried esiApplicable=true despite
  // ₹1.5L+ gross, so the Apr-2026 run wrongly deducted ESI.)
  const esiApplies = args.esiApplicable && isEsiApplicable(gross);
  const esiEmployee = esiApplies ? round(salaryBeforeEsi * ESI_EMPLOYEE_RATE) : 0;
  const esiEmployer = esiApplies ? round(salaryBeforeEsi * ESI_EMPLOYER_RATE) : 0;
  // PF: 12% of basicAfterLop, capped at the statutory ₹15,000 wage
  // ceiling (so each side maxes out at ₹1,800/month).
  const pfBase = Math.min(basicAfterLop, PF_WAGE_CEILING);
  const pfEmployee = args.pfApplicable ? round(pfBase * PF_RATE) : 0;
  const pfEmployer = args.pfApplicable ? round(pfBase * PF_RATE) : 0;
  const pt = args.professionalTax;

  const netSalary = round(salaryBeforeEsi - esiEmployee - pfEmployee - pt);

  return {
    ...breakdown,
    totalWorkingDays: wd,
    daysAttended,
    paidLeave: round2(args.daysPaidLeave),
    unpaidLeave: round2(args.daysAbsent + paidUncovered),
    halfDayLeave: round2(args.daysHalfDay),
    totalLeaveForLop,
    monthlySalary: gross,
    basicSalary: breakdown.basic,
    basicAfterLop,
    dailyBasis,
    salaryBeforeEsi,
    esiEmployee,
    esiEmployer,
    pfEmployee,
    pfEmployer,
    professionalTax: pt,
    netSalary,
    esiTotal: esiEmployee + esiEmployer,
    pfTotal: pfEmployee + pfEmployer,
  };
}

export function bucketAttendance(days: { status: string }[]) {
  let p = 0,
    a = 0,
    hd = 0,
    lv = 0;
  for (const d of days) {
    switch (d.status) {
      case "P":
      case "OD":
      case "REG":
        p++;
        break;
      case "A":
        a++;
        break;
      case "HD":
        hd++;
        break;
      case "LV":
        lv++;
        break;
    }
  }
  return { daysPresent: p, daysAbsent: a, daysHalfDay: hd, daysPaidLeave: lv };
}

/**
 * Paid leave the canonical leave engine (hr-leave-balance.ts) counts as "used"
 * for `year` among the given attendance rows: LV = 1.0 day, HD = 0.5 day, and
 * only for dates that fall in that calendar year (attendance dates are stored
 * at midnight UTC).
 *
 * computeSalaryRun adds this back onto the stored leave balance: that balance
 * is already net of the cycle's own LV/HD (the leave engine subtracts decided
 * attendance leave immediately), so covering this cycle's paid leave against it
 * directly would charge the same days twice — once as the balance deduction,
 * again as loss-of-pay. The `year` filter keeps the Dec→Jan cross-year cycle
 * correct: December leave belongs to the previous year's balance, not this one.
 */
export function leaveUsedInYear(days: { date: Date; status: string }[], year: number): number {
  let used = 0;
  for (const d of days) {
    if (d.date.getUTCFullYear() !== year) continue;
    if (d.status === "LV") used += 1;
    else if (d.status === "HD") used += 0.5;
  }
  return used;
}

/**
 * Number of PRESENT days flagged "AL" (Arrived Late beyond grace / LCE quota).
 * Each is docked as a half-day in payroll — being late past the allowance costs
 * 0.5 day. LCE (within the late-coming allowance) is NOT counted. HD days are
 * excluded (they already carry a 0.5 deduction). A regularized/excused day is
 * status REG (not P), so it drops out here → back to full pay.
 */
export function countAlHalfDays(
  days: { id: string; status: string }[],
  tags: Map<string, LateTag>,
): number {
  let n = 0;
  for (const d of days) if (d.status === "P" && tags.get(d.id) === "AL") n++;
  return n;
}

export async function computeSalaryRun(monthKey: string, userId: string | null): Promise<{
  runId: string;
  lineCount: number;
  warnings: string[];
}> {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error("invalid monthKey");
  // Salary cycle = 26th prev month → 25th current month.
  const { year, start, end } = cycleWindowForMonth(monthKey);
  const workingDaysBase = 30;

  const run = await prisma.hrSalaryRun.upsert({
    where: { monthKey },
    update: { status: "draft", workingDaysBase, totalNet: 0 },
    create: {
      monthKey,
      workingDaysBase,
      status: "draft",
      createdById: userId,
    },
  });

  await prisma.hrSalaryRunLine.deleteMany({ where: { runId: run.id } });

  const employees = await prisma.employee.findMany({
    where: { active: true },
    include: { designationRef: true },
  });
  const warnings: string[] = [];
  let totalNet = 0;
  let lineCount = 0;

  for (const e of employees) {
    const structure = await structureForMonth(e.id, monthKey);
    if (!structure) {
      warnings.push(`No salary structure on file for ${e.empCode} ${e.name} — skipped.`);
      continue;
    }
    // Owners (Managing Director / Director) are paid their full structured
    // salary every month. Attendance and leaves do not apply: no attendance
    // is required and there is never any loss-of-pay. ESI/PF/PT still follow
    // their salary structure as HR sets it.
    const isOwner =
      isOwnerDesignation(e.designationRef?.name) || isOwnerDesignation(e.designation);

    let buckets: { daysPresent: number; daysAbsent: number; daysHalfDay: number; daysPaidLeave: number };
    // Paid leave this cycle already deducted from the stored balance (see below).
    let cycleLeaveUsedInYear = 0;
    // Present-but-late-beyond-allowance (AL) days are docked as half-days.
    let alHalfDays = 0;
    if (isOwner) {
      buckets = { daysPresent: 0, daysAbsent: 0, daysHalfDay: 0, daysPaidLeave: 0 };
    } else {
      const attendance = await prisma.hrAttendanceDay.findMany({
        where: { employeeId: e.id, date: { gte: start, lte: end } },
      });
      if (attendance.length === 0) {
        warnings.push(`No attendance for ${e.empCode} ${e.name} in ${monthKey} — skipped.`);
        continue;
      }
      buckets = bucketAttendance(attendance);
      cycleLeaveUsedInYear = leaveUsedInYear(attendance, year);
      const { tags } = computeLateTags(attendance, e.halfHourConcession);
      alHalfDays = countAlHalfDays(attendance, tags);
    }

    const balance = await prisma.hrLeaveBalance.findUnique({
      where: { employeeId_year: { employeeId: e.id, year } },
    });
    // The canonical leave engine (hr-leave-balance.ts) already subtracts this
    // cycle's decided LV/HD from the stored balance (as `used`). calcLine covers
    // this cycle's paid leave against the balance as it stood BEFORE the cycle —
    // so add the cycle's own deduction back. Without this, paid leave that was
    // earned and taken in the same year is charged twice (once as the balance
    // deduction, again as LOP): e.g. Sivapriya (Apr 2026) accrued 4 leave days
    // and took exactly 4, yet showed LOP 5 instead of 1 for her single absence.
    const carried = (balance ? Number(balance.balance) : 0) + cycleLeaveUsedInYear;

    // Trainees are paid on BASIC ONLY — the engine forces allowances/ESI/PF/PT
    // to zero by designation name, overriding whatever the saved structure
    // says. Robust to both the modern relation and the legacy string.
    const isTrainee =
      isTraineeDesignation(e.designationRef?.name) || isTraineeDesignation(e.designation);

    const calc = calcLine({
      workingDaysBase,
      basic: Number(structure.basic),
      hraPct: isTrainee ? 0 : Number(structure.hraPct),
      conveyancePct: isTrainee ? 0 : Number(structure.conveyancePct),
      medicalPct: isTrainee ? 0 : Number(structure.medicalPct),
      specialPct: isTrainee ? 0 : Number(structure.specialPct),
      esiApplicable: isTrainee ? false : structure.esiApplicable,
      pfApplicable: isTrainee ? false : structure.pfApplicable,
      professionalTax: isTrainee ? 0 : Number(structure.professionalTax),
      ...buckets,
      // AL (late beyond allowance) present-days are treated as half-days.
      daysHalfDay: buckets.daysHalfDay + alHalfDays,
      carriedBalanceBefore: carried,
    });

    await prisma.hrSalaryRunLine.create({
      data: {
        runId: run.id,
        employeeId: e.id,
        totalWorkingDays: calc.totalWorkingDays,
        daysAttended: calc.daysAttended,
        paidLeave: calc.paidLeave,
        unpaidLeave: calc.unpaidLeave,
        halfDayLeave: calc.halfDayLeave,
        totalLeaveForLop: calc.totalLeaveForLop,
        monthlySalary: calc.monthlySalary,
        basicSalary: calc.basicSalary,
        basicAfterLop: calc.basicAfterLop,
        dailyBasis: calc.dailyBasis,
        salaryBeforeEsi: calc.salaryBeforeEsi,
        esiEmployee: calc.esiEmployee,
        pfEmployee: calc.pfEmployee,
        professionalTax: calc.professionalTax,
        netSalary: calc.netSalary,
        esiEmployer: calc.esiEmployer,
        pfEmployer: calc.pfEmployer,
        esiTotal: calc.esiTotal,
        pfTotal: calc.pfTotal,
        bankAccount: e.accountNumber,
        bankIfsc: e.ifsc,
        bankName: e.bankName,
        bankBranch: e.branch,
      },
    });
    totalNet += calc.netSalary;
    lineCount++;
  }

  await prisma.hrSalaryRun.update({
    where: { id: run.id },
    data: { totalNet },
  });

  return { runId: run.id, lineCount, warnings };
}
