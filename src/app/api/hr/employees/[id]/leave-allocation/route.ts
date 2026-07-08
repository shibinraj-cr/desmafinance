import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import {
  computeMonthlyLeaveLedger,
  recomputeLeaveBalance,
  leaveLedgerYears,
} from "@/lib/hr-leave-balance";

/**
 * HR's editable monthly paid-leave allocation for the People → Employee →
 * Leave tab. Rows are salary-cycle months (`MMM-YYYY`).
 *
 *   GET  ?year=YYYY  — the cycle-month ledger for the year (view: any HR user).
 *   PUT  { year, months:[{month,paidLeaves}] } — set/clear the per-month paid
 *        leaves (edit: HR Manager / Admin). A null paidLeaves clears the
 *        override so the month falls back to eligibility auto-accrual.
 */

async function ledgerPayload(employeeId: string, year: number) {
  const [ledger, availableYears] = await Promise.all([
    computeMonthlyLeaveLedger(employeeId, year, { fill: "full" }),
    leaveLedgerYears(employeeId),
  ]);
  return { year, availableYears, ...ledger };
}

function parseYear(raw: string | null): number {
  const y = Number(raw);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getUTCFullYear();
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  return NextResponse.json(await ledgerPayload(params.id, year));
}

const PutSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  months: z
    .array(
      z.object({
        month: z.number().int().min(1).max(12),
        paidLeaves: z.number().min(0).max(31).nullable(),
      }),
    )
    .max(12),
});

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = PutSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const { year, months } = parsed.data;
  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    for (const { month, paidLeaves } of months) {
      const periodKey = `${year}-${String(month).padStart(2, "0")}`;
      if (paidLeaves === null) {
        // Clear the override → fall back to eligibility auto-accrual.
        await tx.hrLeaveAccrual.deleteMany({
          where: { employeeId: params.id, periodKey, source: "allocation" },
        });
      } else {
        await tx.hrLeaveAccrual.upsert({
          where: {
            employeeId_periodKey_source: {
              employeeId: params.id,
              periodKey,
              source: "allocation",
            },
          },
          update: { delta: paidLeaves, actorUserId: userId ?? null, reason: "HR monthly allocation" },
          create: {
            employeeId: params.id,
            periodKey,
            source: "allocation",
            delta: paidLeaves,
            reason: "HR monthly allocation",
            actorUserId: userId ?? null,
          },
        });
      }
    }
    // Fold the new allocation into the canonical (calendar-year) balance so the
    // Leave Balances view, self-service, and the salary run's leave-covering all
    // reflect it immediately.
    await recomputeLeaveBalance(params.id, year, { db: tx });
  });

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: "leave_allocation_updated",
      entityType: "Employee",
      entityId: params.id,
      metadata: { employeeId: params.id, year, months },
    },
  });

  return NextResponse.json(await ledgerPayload(params.id, year));
}
