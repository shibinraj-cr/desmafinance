import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

const ApproveSchema = z.object({ action: z.literal("approve") });
const PatchSchema = z.object({
  workingDaysBase: z.number().int().min(20).max(31).optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const run = await prisma.hrSalaryRun.findUnique({
    where: { id: params.id },
    include: {
      lines: {
        include: { employee: { select: { empCode: true, name: true } } },
        orderBy: { employee: { empCode: "asc" } },
      },
    },
  });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = ApproveSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const run = await prisma.hrSalaryRun.findUnique({ where: { id: params.id }, include: { lines: true } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status !== "draft") {
    return NextResponse.json({ error: "already approved or paid" }, { status: 400 });
  }

  const [yearStr] = run.monthKey.split("-");
  const year = +yearStr;
  for (const line of run.lines) {
    const paidPortion = Math.max(0, Number(line.paidLeave) - Math.max(0, Number(line.unpaidLeave) - Number(line.paidLeave)));
    const usedDelta = paidPortion > 0 ? paidPortion : 0;
    if (usedDelta > 0) {
      const bal = await prisma.hrLeaveBalance.findUnique({
        where: { employeeId_year: { employeeId: line.employeeId, year } },
      });
      if (bal) {
        const usedNow = Number(bal.used) + usedDelta;
        const balanceNow = Number(bal.opening) + Number(bal.accrued) - usedNow;
        await prisma.hrLeaveBalance.update({
          where: { id: bal.id },
          data: { used: usedNow, balance: balanceNow },
        });
      }
    }
  }

  const approved = await prisma.hrSalaryRun.update({
    where: { id: run.id },
    data: { status: "hr_approved", approvedById: userId, approvedAt: new Date() },
  });
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "salary_run_approved",
      entityType: "HrSalaryRun",
      entityId: run.id,
      metadata: { monthKey: run.monthKey, totalNet: Number(run.totalNet) },
    },
  });
  return NextResponse.json({ run: approved });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const run = await prisma.hrSalaryRun.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status !== "draft") {
    return NextResponse.json({ error: "run is approved; cannot edit" }, { status: 400 });
  }
  const updated = await prisma.hrSalaryRun.update({
    where: { id: run.id },
    data: { ...parsed.data },
  });
  return NextResponse.json({ run: updated });
}
