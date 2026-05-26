import { prisma } from "./prisma";

/**
 * Shift resolution helpers.
 *
 * The legacy `Employee.shiftId` is a single FK and gets clobbered when
 * HR rotates an employee onto a new shift. That broke historical
 * attendance/late/OT/payroll because old cycles re-resolved against
 * the *new* shift. The fix: layer multiple HrShiftAssignment rows,
 * each with `effectiveFrom` and (optional) `effectiveTo`. For any
 * given date, exactly one approved row is in effect — and historical
 * cycles always see the shift that applied at their time.
 *
 * `Employee.shiftId` is still kept up-to-date as the "current shift"
 * cache so the existing UI / RBAC checks don't have to change.
 */

export type ResolvedShift = {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  halfDayCutoffTime: string | null;
  /** Provenance: which assignment was picked, for debugging / audit. */
  assignmentId: string | null;
  /** Whether the resolution fell back to Employee.shiftId. */
  fromLegacy: boolean;
};

/** Resolve the shift in effect for an employee on a given date. */
export async function resolveShiftForDate(
  employeeId: string,
  date: Date,
): Promise<ResolvedShift | null> {
  // 1. Look for an approved assignment whose window covers `date`.
  const assignment = await prisma.hrShiftAssignment.findFirst({
    where: {
      employeeId,
      status: "approved",
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    orderBy: { effectiveFrom: "desc" },
    include: { shift: true },
  });
  if (assignment) {
    return {
      id: assignment.shift.id,
      code: assignment.shift.code,
      name: assignment.shift.name,
      startTime: assignment.shift.startTime,
      endTime: assignment.shift.endTime,
      graceMinutes: assignment.shift.graceMinutes,
      halfDayCutoffTime: assignment.shift.halfDayCutoffTime,
      assignmentId: assignment.id,
      fromLegacy: false,
    };
  }
  // 2. Fall back to Employee.shiftId (current shift cache). This keeps
  //    old cycles working until HR backfills assignments.
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { shift: true },
  });
  if (emp?.shift) {
    return {
      id: emp.shift.id,
      code: emp.shift.code,
      name: emp.shift.name,
      startTime: emp.shift.startTime,
      endTime: emp.shift.endTime,
      graceMinutes: emp.shift.graceMinutes,
      halfDayCutoffTime: emp.shift.halfDayCutoffTime,
      assignmentId: null,
      fromLegacy: true,
    };
  }
  return null;
}

/**
 * List the full shift assignment timeline for an employee, newest
 * first. Includes nested `shift` for display.
 */
export async function loadAssignmentHistory(employeeId: string) {
  return prisma.hrShiftAssignment.findMany({
    where: { employeeId },
    orderBy: { effectiveFrom: "desc" },
    include: { shift: true },
  });
}

/**
 * Add a new shift assignment. Auto-closes the previous open
 * assignment (if any) by setting its `effectiveTo` to the day before
 * the new `effectiveFrom`. Refuses to add overlapping windows.
 *
 * Returns the created assignment.
 */
export async function addShiftAssignment(args: {
  employeeId: string;
  shiftId: string;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  reason?: string | null;
  status?: "approved" | "pending";
  createdById?: string | null;
}): Promise<{ id: string }> {
  const { employeeId, shiftId, effectiveFrom, effectiveTo, reason } = args;
  const status = args.status ?? "approved";

  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new Error("effectiveTo must be on or after effectiveFrom");
  }

  // Check for overlap against any approved assignment.
  const overlap = await prisma.hrShiftAssignment.findFirst({
    where: {
      employeeId,
      status: "approved",
      effectiveFrom: { lte: effectiveTo ?? new Date("9999-12-31") },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
    },
  });

  return prisma.$transaction(async (tx) => {
    if (overlap) {
      // Auto-close the overlapping assignment one day before the new
      // window starts, but only if it was open-ended *and* its
      // effectiveFrom is strictly before the new from. Otherwise it's
      // a real conflict — bail.
      const newFromMinusOne = new Date(effectiveFrom);
      newFromMinusOne.setUTCDate(newFromMinusOne.getUTCDate() - 1);
      if (overlap.effectiveTo === null && overlap.effectiveFrom < effectiveFrom) {
        await tx.hrShiftAssignment.update({
          where: { id: overlap.id },
          data: { effectiveTo: newFromMinusOne },
        });
      } else {
        throw new Error(
          `Overlapping shift assignment exists for this employee (${overlap.effectiveFrom.toISOString().slice(0, 10)} → ${overlap.effectiveTo?.toISOString().slice(0, 10) ?? "open"}).`,
        );
      }
    }
    const created = await tx.hrShiftAssignment.create({
      data: {
        employeeId,
        shiftId,
        effectiveFrom,
        effectiveTo: effectiveTo ?? null,
        reason: reason ?? null,
        status,
        createdById: args.createdById ?? null,
      },
      select: { id: true },
    });
    // Keep the legacy single-shift cache aligned with the most-recent
    // currently-effective assignment so existing UI keeps working.
    if (status === "approved" && (!effectiveTo || effectiveTo >= new Date())) {
      await tx.employee.update({
        where: { id: employeeId },
        data: { shiftId },
      });
    }
    await tx.hrAuditLog.create({
      data: {
        actorUserId: args.createdById ?? null,
        eventType: "shift_assigned",
        entityType: "HrShiftAssignment",
        entityId: created.id,
        metadata: {
          employeeId,
          shiftId,
          effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
          effectiveTo: effectiveTo ? effectiveTo.toISOString().slice(0, 10) : null,
          reason: reason ?? null,
          status,
        },
      },
    });
    return created;
  });
}
