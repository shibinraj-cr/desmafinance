import { prisma } from "./prisma";
import { cycleWindowForMonth, structureForMonth } from "./hr-data";

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
 *   basicAfterLop   = basic × (daysAttended / workingDaysBase)
 *   salaryBeforeEsi = gross − (dailyBasis × totalLeaveForLop)
 *   ESI employee 0.75% · employer 3.25% on salaryBeforeEsi (if esiApplicable)
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

  const daysAttended = round2(args.daysPresent + paidCovered + args.daysHalfDay * 0.5);
  const totalLeaveForLop = round2(args.daysAbsent + paidUncovered + args.daysHalfDay * 0.5);
  const basicAfterLop = round2((args.basic * daysAttended) / wd);
  const salaryBeforeEsi = round2(gross - dailyBasis * totalLeaveForLop);

  const esiEmployee = args.esiApplicable ? round(salaryBeforeEsi * ESI_EMPLOYEE_RATE) : 0;
  const esiEmployer = args.esiApplicable ? round(salaryBeforeEsi * ESI_EMPLOYER_RATE) : 0;
  const pfEmployee = args.pfApplicable ? round(basicAfterLop * PF_RATE) : 0;
  const pfEmployer = args.pfApplicable ? round(basicAfterLop * PF_RATE) : 0;
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

  const employees = await prisma.employee.findMany({ where: { active: true } });
  const warnings: string[] = [];
  let totalNet = 0;
  let lineCount = 0;

  for (const e of employees) {
    const structure = await structureForMonth(e.id, monthKey);
    if (!structure) {
      warnings.push(`No salary structure on file for ${e.empCode} ${e.name} — skipped.`);
      continue;
    }
    const attendance = await prisma.hrAttendanceDay.findMany({
      where: { employeeId: e.id, date: { gte: start, lte: end } },
    });
    if (attendance.length === 0) {
      warnings.push(`No attendance for ${e.empCode} ${e.name} in ${monthKey} — skipped.`);
      continue;
    }
    const buckets = bucketAttendance(attendance);

    const balance = await prisma.hrLeaveBalance.findUnique({
      where: { employeeId_year: { employeeId: e.id, year } },
    });
    const carried = balance ? Number(balance.balance) : 0;

    const calc = calcLine({
      workingDaysBase,
      basic: Number(structure.basic),
      hraPct: Number(structure.hraPct),
      conveyancePct: Number(structure.conveyancePct),
      medicalPct: Number(structure.medicalPct),
      specialPct: Number(structure.specialPct),
      esiApplicable: structure.esiApplicable,
      pfApplicable: structure.pfApplicable,
      professionalTax: Number(structure.professionalTax),
      ...buckets,
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
