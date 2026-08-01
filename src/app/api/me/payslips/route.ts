import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/payslips — the signed-in employee's approved payslips (newest
 * first). Only non-draft runs, exactly like the /me/payslips server page.
 */
export async function GET() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);
  if (!emp) return NextResponse.json({ payslips: [] });

  const lines = await prisma.hrSalaryRunLine.findMany({
    where: { employeeId: emp.id, run: { status: { not: "draft" } } },
    orderBy: { run: { monthKey: "desc" } },
    include: { run: { select: { id: true, monthKey: true, status: true, approvedAt: true } } },
    take: 36,
  });

  return NextResponse.json({
    payslips: lines.map((l) => ({
      runId: l.run.id,
      monthKey: l.run.monthKey,
      status: l.run.status,
      approvedAt: l.run.approvedAt ? l.run.approvedAt.toISOString() : null,
      daysAttended: Number(l.daysAttended),
      gross: Number(l.salaryBeforeEsi),
      net: Number(l.netSalary),
    })),
  });
}
