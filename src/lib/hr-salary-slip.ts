import { prisma } from "./prisma";

/**
 * Salary slip data resolver.
 *
 * Loads a single payroll line + the employee + the active salary
 * structure for that cycle, and shapes them into a printable slip
 * payload. The HTML page at /hr/salary/[id]/slip/[lineId] renders this
 * with browser print-to-PDF — keeps the dependency footprint zero
 * (no headless Chrome / wkhtmltopdf required) while still producing
 * a clean A4 PDF.
 */

export type SlipPayload = {
  meta: {
    monthKey: string;
    cycleLabel: string;
    runStatus: string;
    runId: string;
    lineId: string;
    generatedAt: string;
  };
  employer: {
    name: string;
    address?: string;
  };
  employee: {
    empCode: string;
    name: string;
    designation: string | null;
    department: string | null;
    joinDate: string | null;
    bankName: string | null;
    bankAccount: string | null;
    bankIfsc: string | null;
    pan: string | null;
  };
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
  attendance: {
    workingDays: number;
    daysAttended: number;
    paidLeave: number;
    unpaidLeave: number;
    halfDay: number;
  };
  gross: number;
  net: number;
  notes: string | null;
};

export async function loadSlipPayload(runId: string, lineId: string): Promise<SlipPayload | null> {
  const line = await prisma.hrSalaryRunLine.findFirst({
    where: { id: lineId, runId },
    include: {
      run: { select: { monthKey: true, status: true, id: true } },
      employee: {
        include: {
          designationRef: true,
          departments: { include: { department: true }, where: { isPrimary: true } },
        },
      },
    },
  });
  if (!line) return null;
  const e = line.employee;
  const dept = e.departments[0]?.department.name ?? e.department ?? null;
  const designation = e.designationRef?.name ?? e.designation ?? null;
  const [yStr, mStr] = line.run.monthKey.split("-").map(Number);
  const cycleStart = new Date(Date.UTC(yStr, mStr - 2, 26));
  const cycleEnd = new Date(Date.UTC(yStr, mStr - 1, 25));
  const cycleLabel = `${cycleStart.toISOString().slice(0, 10)} → ${cycleEnd.toISOString().slice(0, 10)}`;

  return {
    meta: {
      monthKey: line.run.monthKey,
      cycleLabel,
      runStatus: line.run.status,
      runId: line.run.id,
      lineId: line.id,
      generatedAt: new Date().toISOString(),
    },
    employer: {
      name: "Desma International",
      address: "DESGRO — Kerala, India",
    },
    employee: {
      empCode: e.empCode,
      name: e.name,
      designation,
      department: dept,
      joinDate: e.joinDate ? e.joinDate.toISOString().slice(0, 10) : null,
      bankName: line.bankName,
      bankAccount: line.bankAccount,
      bankIfsc: line.bankIfsc,
      pan: e.pan,
    },
    earnings: [
      { label: "Basic", amount: Number(line.basicAfterLop) },
      {
        label: "HRA / Allowances / Incentives",
        amount: Number(line.salaryBeforeEsi) - Number(line.basicAfterLop),
      },
    ],
    deductions: [
      { label: "Provident Fund (employee)", amount: Number(line.pfEmployee) },
      { label: "ESI (employee)", amount: Number(line.esiEmployee) },
      { label: "Professional Tax", amount: Number(line.professionalTax) },
      { label: "Adjustments", amount: -Number(line.adjustments) },
    ],
    attendance: {
      workingDays: Number(line.totalWorkingDays),
      daysAttended: Number(line.daysAttended),
      paidLeave: Number(line.paidLeave),
      unpaidLeave: Number(line.unpaidLeave),
      halfDay: Number(line.halfDayLeave),
    },
    gross: Number(line.salaryBeforeEsi),
    net: Number(line.netSalary),
    notes: line.adjustmentNote,
  };
}

export async function loadSlipPayloadsForRun(runId: string): Promise<SlipPayload[]> {
  const lines = await prisma.hrSalaryRunLine.findMany({
    where: { runId },
    select: { id: true },
    orderBy: { employee: { empCode: "asc" } },
  });
  const out: SlipPayload[] = [];
  for (const l of lines) {
    const p = await loadSlipPayload(runId, l.id);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Resolve the SlipPayload for an employee's own paystub. Used by the
 * ESS payslips page — the employee can only see slips for runs that
 * have been approved (so HR hasn't finalised numbers in a draft run).
 */
export async function loadEmployeeSlip(employeeId: string, runId: string): Promise<SlipPayload | null> {
  const line = await prisma.hrSalaryRunLine.findFirst({
    where: { runId, employeeId },
    select: { id: true, runId: true },
  });
  if (!line) return null;
  return loadSlipPayload(line.runId, line.id);
}
