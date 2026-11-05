import type { Prisma } from "@prisma/client";
import { monthCodeFromDate, subItemsFor } from "./catalog";
import {
  effectiveDesignation,
  isOwnerDesignation,
  isTraineeDesignation,
} from "./hr-salary-engine";

/**
 * Hand-off from payroll to the ledger. Approving a salary run raises one
 * TransactionDraft per employee, which Finance reviews and edits on My Drafts
 * before it goes through the normal approval queue into the ledger.
 *
 * Finance's edits change the booking only. The run stays locked, so the
 * payslip, the Axis file and the PF/ESI returns keep HR's figures.
 */

const INCENTIVE_SUB_ITEM = "Incentive";
const DIRECTORS_SUB_ITEM = "Directors";
const TRAINEE_SUB_ITEM = "Trainee Stipend";
const FALLBACK_SUB_ITEM = "Operational Team";
/** The Axis bulk-upload file is how a run is paid. */
const SALARY_PAYMENT_MODE = "Axis Bank";

/**
 * The day salaries are booked: the 30th of the run's month, as on the Axis
 * file, or the last day of a shorter month.
 */
export function salaryBookingDate(monthKey: string): Date {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(30, lastDay)));
}

/**
 * The ledger sub-item for one employee's salary. Owners and trainees follow
 * from the designation. Everyone else keeps whatever Finance last booked them
 * under, so a correction made once carries into later months.
 */
export function salarySubItem(designation: string | null, lastBooked?: string): string {
  if (isOwnerDesignation(designation)) return DIRECTORS_SUB_ITEM;
  if (isTraineeDesignation(designation)) return TRAINEE_SUB_ITEM;
  return lastBooked ?? FALLBACK_SUB_ITEM;
}

type DraftLine = {
  employeeId: string;
  netSalary: { toString(): string };
  adjustments: { toString(): string };
  designation: string | null;
};

/**
 * The drafts one run raises. The amount is what the Axis file pays, net plus
 * flat adjustments, and a line with nothing to pay raises no draft.
 */
export function salaryDraftRows(opts: {
  run: { id: string; monthKey: string };
  ownerId: string;
  lines: DraftLine[];
  lastBooked: Map<string, string>;
}): Prisma.TransactionDraftCreateManyInput[] {
  const { run, ownerId, lines, lastBooked } = opts;
  const date = salaryBookingDate(run.monthKey);
  const rows: Prisma.TransactionDraftCreateManyInput[] = [];
  for (const line of lines) {
    const amount =
      Math.round((Number(line.netSalary.toString()) + Number(line.adjustments.toString())) * 100) / 100;
    if (amount <= 0) continue;
    rows.push({
      submittedById: ownerId,
      salaryRunId: run.id,
      employeeId: line.employeeId,
      date,
      month: monthCodeFromDate(date),
      type: "Expense",
      category: "Salary",
      subItem: salarySubItem(line.designation, lastBooked.get(line.employeeId)),
      description: `Salary ${run.monthKey}`,
      paymentMode: SALARY_PAYMENT_MODE,
      amount,
      flow: "Outflow",
    });
  }
  return rows;
}

/** Raise a just-approved run's salary drafts inside the approval transaction. */
export async function raiseSalaryDrafts(
  tx: Prisma.TransactionClient,
  run: { id: string; monthKey: string },
  ownerId: string,
): Promise<{ count: number; total: number }> {
  const lines = await tx.hrSalaryRunLine.findMany({
    where: { runId: run.id },
    select: {
      employeeId: true,
      netSalary: true,
      adjustments: true,
      employee: { select: { designation: true, designationRef: { select: { name: true } } } },
    },
  });
  const booked = await tx.transaction.findMany({
    where: {
      deletedAt: null,
      type: "Expense",
      category: "Salary",
      employeeId: { in: lines.map((l) => l.employeeId) },
      // Incentives are one-off, and retired sub-items would fail Finance's next edit.
      subItem: { in: subItemsFor("Expense", "Salary").filter((s) => s !== INCENTIVE_SUB_ITEM) },
    },
    orderBy: { date: "desc" },
    distinct: ["employeeId"],
    select: { employeeId: true, subItem: true },
  });
  const rows = salaryDraftRows({
    run,
    ownerId,
    lines: lines.map((l) => ({ ...l, designation: effectiveDesignation(l.employee) })),
    lastBooked: new Map(booked.flatMap((b) => (b.employeeId ? [[b.employeeId, b.subItem]] : []))),
  });
  await tx.transactionDraft.createMany({ data: rows });
  return {
    count: rows.length,
    total: rows.reduce((sum, r) => sum + Number(r.amount), 0),
  };
}
