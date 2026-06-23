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
  const run = await prisma.hrSalaryRun.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status !== "draft") {
    return NextResponse.json({ error: "already approved or paid" }, { status: 400 });
  }

  // Note: approval no longer mutates HrLeaveBalance. The canonical leave engine
  // (src/lib/hr-leave-balance.ts) is the single source of truth and already
  // counts decided attendance leave as `used` the moment it's recorded. The old
  // approval-time decrement here was a leftover "drifting path" that double-
  // deducted those same days — pushing balances negative until the next
  // canonical recompute reset them. Salary approval changes no leave facts, so
  // it must not touch balances.
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
