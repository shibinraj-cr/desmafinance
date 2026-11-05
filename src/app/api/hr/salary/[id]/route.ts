import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, type HrSalaryRun } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";
import { recordAudit } from "@/lib/audit";
import { raiseSalaryDrafts } from "@/lib/hr-salary-finance";

const ActionSchema = z.object({ action: z.enum(["approve", "send_to_finance"]) });
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
  if (!userId || !canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = ActionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const run = await prisma.hrSalaryRun.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (parsed.data.action === "send_to_finance") return sendToFinance(run, userId);

  // Note: approval no longer mutates HrLeaveBalance. The canonical leave engine
  // (src/lib/hr-leave-balance.ts) is the single source of truth and already
  // counts decided attendance leave as `used` the moment it's recorded. The old
  // approval-time decrement here was a leftover "drifting path" that double-
  // deducted those same days — pushing balances negative until the next
  // canonical recompute reset them. Salary approval changes no leave facts, so
  // it must not touch balances.
  //
  // Approval and the salary drafts it raises commit together, and only the
  // request that wins the draft → hr_approved flip raises them, so a double
  // click can't send the run to Finance twice.
  const approvedAt = new Date();
  const drafts = await prisma.$transaction(async (tx) => {
    const claimed = await tx.hrSalaryRun.updateMany({
      where: { id: run.id, status: "draft" },
      data: { status: "hr_approved", approvedById: userId, approvedAt },
    });
    return claimed.count === 1 ? raiseSalaryDrafts(tx, run, userId) : null;
  });
  if (!drafts) {
    return NextResponse.json({ error: "already approved or paid" }, { status: 400 });
  }
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "salary_run_approved",
      entityType: "HrSalaryRun",
      entityId: run.id,
      metadata: { monthKey: run.monthKey, totalNet: Number(run.totalNet), financeDrafts: drafts.count },
    },
  });
  await recordAudit({
    entityType: "HrSalaryRun",
    entityId: run.id,
    action: "DRAFT_CREATE",
    userId,
    changes: { monthKey: run.monthKey, drafts: drafts.count, total: drafts.total },
  });
  return NextResponse.json({
    run: { ...run, status: "hr_approved", approvedById: userId, approvedAt },
    financeDrafts: drafts.count,
  });
}

/**
 * Send an approved run to Finance after the fact. A run approved before the
 * hand-off existed raised no drafts, so HR sends it once. It must still be
 * approved, with nothing waiting in Finance and nothing submitted from it. Two
 * requests racing past that check both insert, and the (salaryRunId,
 * employeeId) index fails the second, so a double click can't send it twice.
 */
async function sendToFinance(run: HrSalaryRun, userId: string) {
  let drafts: { count: number; total: number } | null;
  try {
    drafts = await prisma.$transaction(async (tx) => {
      const current = await tx.hrSalaryRun.findUnique({
        where: { id: run.id },
        select: { status: true, financeSubmittedAt: true, _count: { select: { financeDrafts: true } } },
      });
      if (current?.status !== "hr_approved" || current.financeSubmittedAt || current._count.financeDrafts > 0) {
        return null;
      }
      return raiseSalaryDrafts(tx, run, userId);
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    drafts = null;
  }
  if (!drafts) {
    return NextResponse.json(
      { error: "This run isn't approved, or its salaries are already with Finance." },
      { status: 409 },
    );
  }
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "salary_run_sent_to_finance",
      entityType: "HrSalaryRun",
      entityId: run.id,
      metadata: { monthKey: run.monthKey, financeDrafts: drafts.count, total: drafts.total },
    },
  });
  await recordAudit({
    entityType: "HrSalaryRun",
    entityId: run.id,
    action: "DRAFT_CREATE",
    userId,
    changes: { monthKey: run.monthKey, drafts: drafts.count, total: drafts.total },
  });
  return NextResponse.json({ financeDrafts: drafts.count });
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
