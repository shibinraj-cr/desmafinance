import { prisma } from "./prisma";
import { recomputeLeaveBalance } from "./hr-leave-balance";

/**
 * Monthly leave accrual engine.
 *
 * `runMonthlyAccrual(periodKey)` credits eligible employees their
 * `leavesPerPeriod` for the given YYYY-MM key, writing both:
 *   - an HrLeaveAccrual ledger row (idempotent by unique
 *     [employeeId, periodKey, source='auto']), and
 *   - a bumped HrLeaveBalance for the year that contains the period.
 *
 * Idempotent — running it twice for the same period is a no-op (the
 * unique constraint blocks duplicate ledger rows).
 */
export async function runMonthlyAccrual(periodKey: string): Promise<{
  credited: number;
  skipped: number;
  totalDelta: number;
  details: { employeeId: string; empCode: string; delta: number; status: "credited" | "skipped"; reason?: string }[];
}> {
  if (!/^\d{4}-\d{2}$/.test(periodKey)) throw new Error("periodKey must be YYYY-MM");
  const [yStr, mStr] = periodKey.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0));

  const eligibilities = await prisma.hrLeaveEligibility.findMany({
    where: { enabled: true, effectiveFrom: { lte: periodEnd } },
    include: { employee: { select: { id: true, empCode: true, active: true } } },
  });

  const details: { employeeId: string; empCode: string; delta: number; status: "credited" | "skipped"; reason?: string }[] = [];
  let credited = 0;
  let skipped = 0;
  let totalDelta = 0;

  for (const e of eligibilities) {
    if (!e.employee.active) {
      details.push({ employeeId: e.employeeId, empCode: e.employee.empCode, delta: 0, status: "skipped", reason: "inactive" });
      skipped++;
      continue;
    }
    const delta = Number(e.leavesPerPeriod);
    if (delta === 0) {
      details.push({ employeeId: e.employeeId, empCode: e.employee.empCode, delta: 0, status: "skipped", reason: "zero allocation" });
      skipped++;
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        // 1. Idempotent ledger insert (history; the unique constraint blocks
        //    a second run for the same period).
        await tx.hrLeaveAccrual.create({
          data: {
            employeeId: e.employeeId,
            periodKey,
            delta,
            source: "auto",
            leaveType: e.leaveType,
            reason: `Monthly accrual ${periodKey}`,
          },
        });
        // 2. Recompute the canonical balance. Accrued is derived from
        //    eligibility entitlement-to-date, so crediting this period simply
        //    means the elapsed-month count (and thus the balance) moves up.
        await recomputeLeaveBalance(e.employeeId, year, { db: tx });
      });
      credited++;
      totalDelta += delta;
      details.push({ employeeId: e.employeeId, empCode: e.employee.empCode, delta, status: "credited" });
    } catch (err: unknown) {
      // P2002 = unique constraint (already accrued for this period).
      const msg = err instanceof Error ? err.message : "failed";
      const isDup = msg.includes("Unique constraint") || msg.includes("P2002");
      skipped++;
      details.push({
        employeeId: e.employeeId,
        empCode: e.employee.empCode,
        delta: 0,
        status: "skipped",
        reason: isDup ? "already accrued" : msg,
      });
    }
  }

  await prisma.hrAuditLog.create({
    data: {
      eventType: "leave_accrual_run",
      entityType: "HrLeaveAccrual",
      metadata: { periodKey, credited, skipped, totalDelta },
    },
  });

  return { credited, skipped, totalDelta, details };
}

/** Apply a manual ledger adjustment (HR side). */
export async function manualAdjustment(args: {
  employeeId: string;
  delta: number;
  reason: string;
  actorUserId: string | null;
  leaveType?: string;
}): Promise<void> {
  const { employeeId, delta, reason, actorUserId } = args;
  if (delta === 0) throw new Error("delta cannot be zero");
  const periodKey = new Date().toISOString().slice(0, 7);
  const year = new Date().getUTCFullYear();
  await prisma.$transaction(async (tx) => {
    await tx.hrLeaveAccrual.create({
      data: {
        employeeId,
        periodKey,
        delta,
        source: "manual",
        leaveType: args.leaveType ?? "CL",
        reason,
        actorUserId,
      },
    });
    // The recompute folds this manual ledger delta into `accrued` (it sums
    // source 'manual' / 'expiry' rows for the year).
    await recomputeLeaveBalance(employeeId, year, { db: tx });
    await tx.hrAuditLog.create({
      data: {
        actorUserId,
        eventType: "leave_adjustment",
        entityType: "HrLeaveAccrual",
        metadata: { employeeId, delta, reason, periodKey },
      },
    });
  });
}
