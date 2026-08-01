import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { loadEmployeeSlip } from "@/lib/hr-salary-slip";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/payslips/[id] — full slip for one payroll run (id = runId) for the
 * signed-in employee. Preserves the ESS rules from the server page: draft runs
 * are hidden, and a self_payslip_viewed audit row is written.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);
  if (!emp) return NextResponse.json({ error: "not_linked" }, { status: 400 });

  const run = await prisma.hrSalaryRun.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (run.status === "draft") {
    return NextResponse.json({ error: "not_approved" }, { status: 403 });
  }

  const slip = await loadEmployeeSlip(emp.id, run.id);
  if (!slip) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "self_payslip_viewed",
      entityType: "HrSalaryRunLine",
      entityId: slip.meta.lineId,
      metadata: { runId: run.id, monthKey: run.monthKey },
    },
  });

  return NextResponse.json({ slip });
}
