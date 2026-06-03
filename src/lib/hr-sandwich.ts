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
 * Half-day awareness: a half-day (HD) only "bridges" into an adjacent
 * weekend/holiday when the *absent half touches that bridge*. A leave
 * taken in the afternoon (2nd half) touches the end of the day, so it can
 * bridge into a FOLLOWING week-off; a leave taken in the morning (1st
 * half) touches the start of the day, so it can close a sandwich coming
 * FROM a preceding week-off. A full-day leave (A/LV) touches both ends.
 * The half is inferred from punch deviations (see inferHdLeaveHalf).
 *
 * Returns the list of day rows that were re-tagged.
 */

export type SandwichResult = {
  flipped: { dayId: string; date: string; from: string; to: string }[];
  policyApplied: { departmentId: string | null; maxGapDays: number };
};

type SandwichPolicyLite = {
  includeHolidays: boolean;
  includeWeekOffs: boolean;
  maxGapDays: number;
};

/** Minimal day shape the resolver needs (also what the unit tests build). */
export type SandwichDay = {
  id: string;
  date: Date;
  status: string;
  lateMinutes: number | null;
  earlyOutMinutes: number | null;
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
 * Infer which half of a half-day (HD) was the leave, from punch
 * deviations. Arrived late (lateMinutes dominates) → the morning is
 * missing → "AM" (1st half). Left early (earlyOutMinutes dominates) →
 * the afternoon is missing → "PM" (2nd half). When we genuinely can't
 * tell (both zero/equal — e.g. came late *and* left early), return null;
 * such a day is treated as bridging both directions so the rule errs
 * toward enforcement rather than silently skipping a sandwich.
 */
export function inferHdLeaveHalf(d: {
  lateMinutes: number | null;
  earlyOutMinutes: number | null;
}): "AM" | "PM" | null {
  const late = d.lateMinutes ?? 0;
  const eo = d.earlyOutMinutes ?? 0;
  if (late > eo) return "AM";
  if (eo > late) return "PM";
  return null;
}

/** Can this leave day extend a sandwich INTO a following bridge? (PM touches the upcoming week-off.) */
function bridgesForward(d: SandwichDay): boolean {
  if (d.status === "A" || d.status === "LV") return true;
  if (d.status === "HD") {
    const half = inferHdLeaveHalf(d);
    return half === "PM" || half === null;
  }
  return false;
}

/** Can this leave day CLOSE a sandwich coming FROM a preceding bridge? (AM touches the preceding week-off.) */
function bridgesBackward(d: SandwichDay): boolean {
  if (d.status === "A" || d.status === "LV") return true;
  if (d.status === "HD") {
    const half = inferHdLeaveHalf(d);
    return half === "AM" || half === null;
  }
  return false;
}

function isBridgeStatus(s: string, policy: SandwichPolicyLite): boolean {
  if (s === "WO") return policy.includeWeekOffs;
  if (s === "HL") return policy.includeHolidays;
  return false;
}

/**
 * Pure resolver: given an employee's days (ordered by date asc) and the
 * active policy, return the intermediate bridge rows that should flip to
 * "A". No DB access — this is the unit-tested core of the rule.
 */
export function computeSandwichFlips(
  days: SandwichDay[],
  policy: SandwichPolicyLite,
): { dayId: string; date: string; from: string; to: string }[] {
  const flipped: { dayId: string; date: string; from: string; to: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < days.length; i++) {
    // Left anchor: a leave whose absent half touches the *end* of the day.
    if (!bridgesForward(days[i])) continue;
    for (let j = i + 1; j < days.length; j++) {
      if (j - i > policy.maxGapDays) break;
      // Accumulate consecutive bridge days (WO/HL).
      if (isBridgeStatus(days[j].status, policy)) continue;
      // First non-bridge day after the left anchor: it either closes the
      // sandwich (right anchor) or ends the scan. Everything between i and j
      // is bridge-only by construction.
      const intermediates = days.slice(i + 1, j);
      if (intermediates.length > 0 && bridgesBackward(days[j])) {
        for (const d of intermediates) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          flipped.push({
            dayId: d.id,
            date: d.date.toISOString().slice(0, 10),
            from: d.status,
            to: "A",
          });
        }
      }
      break;
    }
  }
  return flipped;
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
    select: { id: true, date: true, status: true, lateMinutes: true, earlyOutMinutes: true },
  });
  if (days.length === 0) {
    return { flipped: [], policyApplied: { departmentId: policy.departmentId, maxGapDays: policy.maxGapDays } };
  }

  const flipped = computeSandwichFlips(days, policy);

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
