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

/** A single approved assignment window, with its shift already flattened. */
export type ShiftTimelineEntry = {
  from: Date;
  /** Null = open-ended (still in effect). */
  to: Date | null;
  shift: ResolvedShift;
};

/**
 * Every approved assignment window for an employee plus the legacy
 * `Employee.shiftId` fallback, loaded in one go.
 *
 * Callers that need the shift for MANY dates (the attendance recompute walks a
 * whole salary cycle day by day) must load this once and then call
 * `pickShiftForDate` per date — resolving per day against the DB would be a
 * query per attendance row, and resolving ONCE for the whole window is the bug
 * this type exists to prevent: a mid-cycle shift change was silently ignored
 * for the rest of the cycle.
 */
export type ShiftTimeline = {
  /** Newest `effectiveFrom` first — the first covering window wins. */
  entries: ShiftTimelineEntry[];
  /** Used for dates no approved window covers. */
  legacy: ResolvedShift | null;
};

/** Strip the time component so date-only DB columns compare cleanly. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Load an employee's full approved shift timeline (one pass, two queries). */
export async function loadShiftTimeline(employeeId: string): Promise<ShiftTimeline> {
  const [assignments, emp] = await Promise.all([
    prisma.hrShiftAssignment.findMany({
      where: { employeeId, status: "approved" },
      orderBy: { effectiveFrom: "desc" },
      include: { shift: true },
    }),
    prisma.employee.findUnique({ where: { id: employeeId }, include: { shift: true } }),
  ]);
  return {
    entries: assignments.map((a) => ({
      from: a.effectiveFrom,
      to: a.effectiveTo,
      shift: {
        id: a.shift.id,
        code: a.shift.code,
        name: a.shift.name,
        startTime: a.shift.startTime,
        endTime: a.shift.endTime,
        graceMinutes: a.shift.graceMinutes,
        halfDayCutoffTime: a.shift.halfDayCutoffTime,
        assignmentId: a.id,
        fromLegacy: false,
      },
    })),
    legacy: emp?.shift
      ? {
          id: emp.shift.id,
          code: emp.shift.code,
          name: emp.shift.name,
          startTime: emp.shift.startTime,
          endTime: emp.shift.endTime,
          graceMinutes: emp.shift.graceMinutes,
          halfDayCutoffTime: emp.shift.halfDayCutoffTime,
          assignmentId: null,
          fromLegacy: true,
        }
      : null,
  };
}

/**
 * Pick the shift in effect on `date` from an already-loaded timeline. Pure —
 * no DB access, so it is cheap to call once per attendance day.
 *
 * Falls back to the legacy `Employee.shiftId` cache when no approved window
 * covers the date (employees HR never backfilled assignments for).
 */
export function pickShiftForDate(timeline: ShiftTimeline, date: Date): ResolvedShift | null {
  const day = utcDay(date);
  for (const e of timeline.entries) {
    if (e.from <= day && (e.to === null || e.to >= day)) return e.shift;
  }
  return timeline.legacy;
}

/**
 * Resolve the shift in effect for an employee on a single given date.
 * For a range of dates use `loadShiftTimeline` + `pickShiftForDate` instead.
 */
export async function resolveShiftForDate(
  employeeId: string,
  date: Date,
): Promise<ResolvedShift | null> {
  return pickShiftForDate(await loadShiftTimeline(employeeId), date);
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

/**
 * Change an employee's shift from the employee record (HR "edit employee").
 *
 * Writing `Employee.shiftId` on its own rewrites history: with no assignment
 * window covering the past, `pickShiftForDate` falls back to the cache and
 * every past day re-derives against the NEW shift. So this does the dated
 * thing instead:
 *
 *   1. If the employee has no assignment history yet, seed a CLOSED window for
 *      the outgoing shift (join date → the day before the change) so past
 *      attendance keeps resolving to the shift that actually applied.
 *   2. Open a new window for the incoming shift from `effectiveFrom`
 *      (default: today). `addShiftAssignment` auto-closes the predecessor and
 *      refreshes the `Employee.shiftId` cache.
 *
 * Callers should follow up with `recomputeAfterShiftChange()` so the days
 * already stored are re-derived against the corrected timeline.
 */
export async function changeEmployeeShift(args: {
  employeeId: string;
  shiftId: string | null;
  effectiveFrom?: Date;
  reason?: string | null;
  createdById?: string | null;
}): Promise<{
  changed: boolean;
  assignmentId: string | null;
  seededHistory: boolean;
  effectiveFrom: Date;
}> {
  const { employeeId, shiftId } = args;
  const from = utcDay(args.effectiveFrom ?? new Date());
  const dayBefore = new Date(from);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, shiftId: true, joinDate: true },
  });
  if (!emp || emp.shiftId === shiftId) {
    return { changed: false, assignmentId: null, seededHistory: false, effectiveFrom: from };
  }

  // Clearing the shift: close the open window, drop the cache. No new window.
  if (!shiftId) {
    await prisma.hrShiftAssignment.updateMany({
      where: { employeeId, status: "approved", effectiveTo: null, effectiveFrom: { lt: from } },
      data: { effectiveTo: dayBefore },
    });
    await prisma.employee.update({ where: { id: employeeId }, data: { shiftId: null } });
    return { changed: true, assignmentId: null, seededHistory: false, effectiveFrom: from };
  }

  // Seed the outgoing shift's history, but only for employees who have never
  // had an assignment row — otherwise the existing timeline already covers it.
  let seededHistory = false;
  const existingCount = await prisma.hrShiftAssignment.count({
    where: { employeeId, status: "approved" },
  });
  if (existingCount === 0 && emp.shiftId) {
    const firstDay = emp.joinDate
      ? utcDay(emp.joinDate)
      : (
          await prisma.hrAttendanceDay.findFirst({
            where: { employeeId },
            orderBy: { date: "asc" },
            select: { date: true },
          })
        )?.date ?? null;
    // Only seedable if the employee's history actually starts before the change.
    if (firstDay && firstDay <= dayBefore) {
      await prisma.hrShiftAssignment.create({
        data: {
          employeeId,
          shiftId: emp.shiftId,
          effectiveFrom: firstDay,
          effectiveTo: dayBefore,
          reason: "Backfilled from employee record on shift change",
          status: "approved",
          createdById: args.createdById ?? null,
        },
      });
      seededHistory = true;
    }
  }

  const created = await addShiftAssignment({
    employeeId,
    shiftId,
    effectiveFrom: from,
    reason: args.reason ?? "Changed from employee record",
    status: "approved",
    createdById: args.createdById ?? null,
  });
  return { changed: true, assignmentId: created.id, seededHistory, effectiveFrom: from };
}
