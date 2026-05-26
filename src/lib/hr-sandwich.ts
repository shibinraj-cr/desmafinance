import { prisma } from "./prisma";

/**
 * Sandwich-rule resolver.
 *
 * If an employee takes leave on the day BEFORE *and* AFTER a stretch of
 * intermediate week-offs / holidays, those intermediate days get
 * counted as leave (LOP) too. Implemented as a post-decide pass that
 * walks the employee's days in a window and flips eligible
 * intermediate WO/HL rows from "WO"/"HL" → "A" (unpaid LOP) with a
 * sandwich audit tag.
 *
 * Returns the list of day rows that were re-tagged.
 */

export type SandwichResult = {
  flipped: { dayId: string; date: string; from: string; to: string }[];
  policyApplied: { departmentId: string | null; maxGapDays: number };
};

/**
 * Pick the active sandwich policy: a department-scoped row if one
 * matches the employee's primary department, else the company-wide
 * (departmentId=null) row, else a sensible default ({enabled: true,
 * includeHolidays: true, includeWeekOffs: true, maxGapDays: 7}).
 */
export async function getActiveSandwichPolicy(employeeId: string) {
  const primaryDept = await prisma.hrEmployeeDepartment.findFirst({
    where: { employeeId, isPrimary: true },
    select: { departmentId: true },
  });
  const scoped = primaryDept
    ? await prisma.hrSandwichPolicy.findFirst({
        where: { departmentId: primaryDept.departmentId, enabled: true },
      })
    : null;
  const global = await prisma.hrSandwichPolicy.findFirst({
    where: { departmentId: null, enabled: true },
  });
  const picked = scoped ?? global;
  if (picked) return picked;
  // Sane defaults — return a synthetic "policy" object for callers.
  return {
    id: null as string | null,
    departmentId: null as string | null,
    enabled: true,
    includeHolidays: true,
    includeWeekOffs: true,
    maxGapDays: 7,
  };
}

/**
 * Apply the sandwich rule to one employee's days in a window. Returns
 * a SandwichResult. Pass actorUserId so the audit log captures who
 * triggered the rule.
 */
export async function applySandwichRule(args: {
  employeeId: string;
  windowStart: Date;
  windowEnd: Date;
  actorUserId: string | null;
}): Promise<SandwichResult> {
  const { employeeId, windowStart, windowEnd, actorUserId } = args;
  const policy = await getActiveSandwichPolicy(employeeId);
  if (!policy.enabled) {
    return { flipped: [], policyApplied: { departmentId: policy.departmentId, maxGapDays: policy.maxGapDays } };
  }

  const days = await prisma.hrAttendanceDay.findMany({
    where: { employeeId, date: { gte: windowStart, lte: windowEnd } },
    orderBy: { date: "asc" },
    select: { id: true, date: true, status: true },
  });
  if (days.length === 0) {
    return { flipped: [], policyApplied: { departmentId: policy.departmentId, maxGapDays: policy.maxGapDays } };
  }

  // Walk in order. For each pair of leave rows (A or LV with deciding),
  // check whether the intermediate stretch is *only* WO/HL and within
  // maxGapDays. If so, flip them.
  const flipped: { dayId: string; date: string; from: string; to: string }[] = [];
  for (let i = 0; i < days.length; i++) {
    const left = days[i];
    if (!isLeaveStatus(left.status)) continue;
    for (let j = i + 1; j < days.length; j++) {
      const right = days[j];
      if (j - i > policy.maxGapDays) break;
      if (!isLeaveStatus(right.status)) {
        // The intermediates must be exclusively WO/HL — anything else
        // (P, HD, etc.) breaks the sandwich.
        if (!isBridgeStatus(right.status, policy)) break;
        continue;
      }
      // We have left & right as leave; check intermediates.
      const intermediates = days.slice(i + 1, j);
      if (intermediates.length === 0) break;
      const allBridge = intermediates.every((d) => isBridgeStatus(d.status, policy));
      if (!allBridge) break;
      // Flip each intermediate to A (unpaid).
      for (const d of intermediates) {
        flipped.push({
          dayId: d.id,
          date: d.date.toISOString().slice(0, 10),
          from: d.status,
          to: "A",
        });
      }
      break;
    }
  }

  if (flipped.length > 0) {
    await prisma.$transaction([
      ...flipped.map((f) =>
        prisma.hrAttendanceDay.update({
          where: { id: f.dayId },
          data: {
            status: "A",
            decidedById: actorUserId,
            decidedAt: new Date(),
            decisionNote: `Sandwich rule (${f.from} → A)`,
          },
        }),
      ),
      prisma.hrAuditLog.create({
        data: {
          actorUserId,
          eventType: "sandwich_rule_applied",
          entityType: "HrAttendanceDay",
          metadata: {
            employeeId,
            flipped,
            policyId: policy.id,
            departmentId: policy.departmentId,
            maxGapDays: policy.maxGapDays,
          },
        },
      }),
    ]);
  }

  return { flipped, policyApplied: { departmentId: policy.departmentId, maxGapDays: policy.maxGapDays } };
}

function isLeaveStatus(s: string): boolean {
  return s === "A" || s === "LV" || s === "HD";
}

function isBridgeStatus(
  s: string,
  policy: { includeHolidays: boolean; includeWeekOffs: boolean },
): boolean {
  if (s === "WO") return policy.includeWeekOffs;
  if (s === "HL") return policy.includeHolidays;
  return false;
}
