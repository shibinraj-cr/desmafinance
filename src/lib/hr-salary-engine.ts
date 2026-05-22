import { prisma } from "./prisma";
import { parseMonthKey, structureForMonth } from "./hr-data";

/**
 * Salary calculation engine. Mirrors the formulas observed in the
 * reference Jan–Apr 2026 spreadsheets:
 *
 *   Daily basis         = Monthly / workingDaysBase                  (30 by default)
 *   Basic               = Monthly × basicPct%
 *   Basic after LOP     = Basic × (attended / workingDaysBase)
 *   Salary before ESI   = Monthly − (Daily basis × totalLeaveForLop)
 *   ESI employee 0.75%  · employer 3.25%  (on Salary before ESI; only if esiApplicable)
 *   PF employee 12%     · employer 12%    (on Basic after LOP; only if pfApplicable)
 *   Professional Tax    = flat
 *   Net                 = Salary before ESI − ESI(E) − PF(E) − PT + adjustments
 */

export type SalaryCalc = {
  totalWorkingDays: number;
  daysAttended: number;
  paidLeave: number;
  unpaidLeave: number;
  halfDayLeave: number;
  totalLeaveForLop: number;
  monthlySalary: number;
  basicSalary: number;
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

export function calcLine(args: {
  workingDaysBase: number;
  monthlySalary: number;
  basicPct: number;
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
  const monthly = args.monthlySalary;
  const basic = round2((monthly * args.basicPct) / 100);
  const dailyBasis = round2(monthly / wd);

  const paidCovered = Math.min(args.daysPaidLeave, Math.max(0, args.carriedBalanceBefore));
  const paidUncovered = Math.max(0, args.daysPaidLeave - paidCovered);

  const daysAttended = round2(args.daysPresent + paidCovered + args.daysHalfDay * 0.5);
  const totalLeaveForLop = round2(args.daysAbsent + paidUncovered + args.daysHalfDay * 0.5);
  const basicAfterLop = round2((basic * daysAttended) / wd);
  const salaryBeforeEsi = round2(monthly - dailyBasis * totalLeaveForLop);

  const esiEmployee = args.esiApplicable ? round(salaryBeforeEsi * 0.0075) : 0;
  const esiEmployer = args.esiApplicable ? round(salaryBeforeEsi * 0.0325) : 0;
  const pfEmployee = args.pfApplicable ? round(basicAfterLop * 0.12) : 0;
  const pfEmployer = args.pfApplicable ? round(basicAfterLop * 0.12) : 0;
  const pt = args.professionalTax;

  const netSalary = round(salaryBeforeEsi - esiEmployee - pfEmployee - pt);

  return {
    totalWorkingDays: wd,
    daysAttended,
    paidLeave: round2(args.daysPaidLeave),
    unpaidLeave: round2(args.daysAbsent + paidUncovered),
    halfDayLeave: round2(args.daysHalfDay),
    totalLeaveForLop,
    monthlySalary: monthly,
    basicSalary: basic,
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
  const { year, month, start, end } = parseMonthKey(monthKey);
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
      monthlySalary: Number(structure.monthlySalary),
      basicPct: Number(structure.basicPct),
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
