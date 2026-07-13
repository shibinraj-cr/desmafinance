/**
 * DB side of the Attendance Scorecard. Assembles one {@link AttendanceScoreRow}
 * per active employee over a rolling window of salary cycles, then runs the pure
 * scorer in `hr-attendance-score.ts`.
 *
 * The window is the last {@link ROLLING_CYCLES} cycles ending at the requested
 * cycle-month (each cycle = 26th → 25th). AL / LCE tags are computed PER CYCLE —
 * the LCE grace quota resets each cycle — and then summed, so the rolling score
 * stays consistent with what payroll charged month by month.
 */
import { prisma } from "./prisma";
import {
  cycleWindowForMonth,
  cycleMonthForDate,
  computeLateTags,
  SHIFT_GRACE_MINUTES,
} from "./hr-data";
import { bucketAttendance, isOwnerDesignation } from "./hr-salary-engine";
import {
  buildAttendanceScorecard,
  scoreAttendance,
  type AttendanceScoreRow,
  type AttendanceScore,
} from "./hr-attendance-score";

/** Number of salary cycles the rolling score spans. */
export const ROLLING_CYCLES = 3;

/** Leaving more than this many minutes before shift end counts as an early departure. */
const EARLY_OUT_GRACE_MINUTES = SHIFT_GRACE_MINUTES;

type AttDay = {
  id: string;
  employeeId: string;
  date: Date;
  status: string;
  inTime: string | null;
  outTime: string | null;
  lateMinutes: number | null;
  earlyOutMinutes: number | null;
};

type EmpRef = {
  id: string;
  empCode: string;
  name: string;
  halfHourConcession: boolean;
  designation: string | null;
  designationRef: { name: string } | null;
};

/** Shift a cycle-month key ("YYYY-MM") by a whole number of months. */
export function addCycleMonths(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** The cycle-month keys the rolling window covers, oldest → newest. */
export function rollingCycleMonths(cycleMonth: string, count = ROLLING_CYCLES): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) months.push(addCycleMonths(cycleMonth, -i));
  return months;
}

/** True for a day with exactly one punch (an in without an out, or vice versa). */
function isMissingPunch(d: AttDay): boolean {
  return !!d.inTime !== !!d.outTime;
}

/**
 * Aggregate one employee's days (already filtered to this employee, spanning the
 * whole window) into a scorer row. AL/LCE are tallied per cycle so the per-cycle
 * LCE quota applies correctly.
 */
function buildRow(emp: EmpRef, days: AttDay[], regRequests: number, cyclesCovered: number): AttendanceScoreRow {
  const { daysPresent, daysAbsent, daysHalfDay, daysPaidLeave } = bucketAttendance(days);

  // Per-cycle AL/LCE — group the employee's days by which cycle they fall in.
  const byCycle = new Map<string, AttDay[]>();
  for (const d of days) {
    const key = cycleMonthForDate(d.date);
    (byCycle.get(key) ?? byCycle.set(key, []).get(key)!).push(d);
  }
  let alDays = 0;
  let lceDays = 0;
  for (const cycleDays of byCycle.values()) {
    const { alCount, lceUsed } = computeLateTags(cycleDays, emp.halfHourConcession);
    alDays += alCount;
    lceDays += lceUsed;
  }

  // Early departures and missing punches count only where the employee actually worked.
  let earlyOutDays = 0;
  let missingPunchDays = 0;
  for (const d of days) {
    const worked = d.status === "P" || d.status === "HD";
    if (worked && (d.earlyOutMinutes ?? 0) > EARLY_OUT_GRACE_MINUTES) earlyOutDays++;
    if (isMissingPunch(d)) missingPunchDays++;
  }

  return {
    employeeId: emp.id,
    empCode: emp.empCode,
    name: emp.name,
    designation: emp.designationRef?.name ?? emp.designation ?? null,
    daysPresent,
    daysHalfDay,
    daysAbsent,
    daysPaidLeave,
    alDays,
    lceDays,
    earlyOutDays,
    missingPunchDays,
    regRequests,
    cyclesCovered,
  };
}

export type AttendanceScorecard = {
  cycleMonth: string;
  /** Oldest → newest cycle-month keys covered. */
  cycleMonths: string[];
  scores: AttendanceScore[];
  /** Scored employees in the "attention" band — the disciplinary follow-up list. */
  flagged: AttendanceScore[];
};

/**
 * Build the full ranked scorecard for the rolling window ending at `cycleMonth`.
 * Owners (MD / Director) have no attendance and are excluded, matching the grid.
 */
export async function loadAttendanceScorecard(cycleMonth: string): Promise<AttendanceScorecard> {
  const cycleMonths = rollingCycleMonths(cycleMonth);
  const start = cycleWindowForMonth(cycleMonths[0]).start;
  const end = cycleWindowForMonth(cycleMonth).end;

  const [employeesRaw, days, regGroups] = await Promise.all([
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { empCode: "asc" },
      select: {
        id: true,
        empCode: true,
        name: true,
        halfHourConcession: true,
        designation: true,
        designationRef: { select: { name: true } },
      },
    }),
    prisma.hrAttendanceDay.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: [{ employeeId: "asc" }, { date: "asc" }],
      select: {
        id: true,
        employeeId: true,
        date: true,
        status: true,
        inTime: true,
        outTime: true,
        lateMinutes: true,
        earlyOutMinutes: true,
      },
    }),
    prisma.hrAttendanceRegularization.groupBy({
      by: ["employeeId"],
      where: { date: { gte: start, lte: end } },
      _count: { _all: true },
    }),
  ]);

  const employees = employeesRaw.filter(
    (e) => !(isOwnerDesignation(e.designationRef?.name) || isOwnerDesignation(e.designation)),
  );

  const daysByEmp = new Map<string, AttDay[]>();
  for (const d of days) (daysByEmp.get(d.employeeId) ?? daysByEmp.set(d.employeeId, []).get(d.employeeId)!).push(d);
  const regByEmp = new Map<string, number>();
  for (const g of regGroups) regByEmp.set(g.employeeId, g._count._all);

  const rows = employees.map((emp) =>
    buildRow(emp, daysByEmp.get(emp.id) ?? [], regByEmp.get(emp.id) ?? 0, cycleMonths.length),
  );

  const scores = buildAttendanceScorecard(rows);
  const flagged = scores.filter((s) => s.scored && s.band === "attention");

  return { cycleMonth, cycleMonths, scores, flagged };
}

/**
 * The rolling attendance score for a single employee — used by the employee's
 * own `/me` self-view. Returns null when the employee is not found / inactive.
 */
export async function attendanceScoreForEmployee(
  employeeId: string,
  cycleMonth: string,
): Promise<AttendanceScore | null> {
  const cycleMonths = rollingCycleMonths(cycleMonth);
  const start = cycleWindowForMonth(cycleMonths[0]).start;
  const end = cycleWindowForMonth(cycleMonth).end;

  const [emp, days, regCount] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        empCode: true,
        name: true,
        halfHourConcession: true,
        designation: true,
        designationRef: { select: { name: true } },
      },
    }),
    prisma.hrAttendanceDay.findMany({
      where: { employeeId, date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
      select: {
        id: true,
        employeeId: true,
        date: true,
        status: true,
        inTime: true,
        outTime: true,
        lateMinutes: true,
        earlyOutMinutes: true,
      },
    }),
    prisma.hrAttendanceRegularization.count({
      where: { employeeId, date: { gte: start, lte: end } },
    }),
  ]);

  if (!emp) return null;
  return scoreAttendance(buildRow(emp, days, regCount, cycleMonths.length));
}
