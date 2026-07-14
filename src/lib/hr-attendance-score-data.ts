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
  type AttScoreBand,
  type AttScoreComponent,
} from "./hr-attendance-score";

/** Number of salary cycles the rolling score spans. */
export const ROLLING_CYCLES = 3;

/** How many months of single-cycle scores the trend graph / monthly matrix show. */
export const TREND_MONTHS = 6;

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short month name for a cycle-month key ("2026-06" → "Jun"). */
export function monthLabel(cycleMonth: string): string {
  const m = Number(cycleMonth.split("-")[1]);
  return MONTH_ABBR[m] ?? cycleMonth;
}

/** The most recent salary cycle whose 26→25 window has fully elapsed. */
export function latestCompleteCycleMonth(today: Date): string {
  const current = cycleMonthForDate(today);
  const end = cycleWindowForMonth(current).end;
  return today > end ? current : addCycleMonths(current, -1);
}

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

/**
 * One employee's score for a single salary cycle (month), for the trend graph
 * and the admin monthly drill-down. `value`/`band` are set only when the month
 * clears the min-data gate; `components` carry the calculation breakdown for the
 * click-to-explain popup whenever the month has any attendance at all.
 */
export type MonthlyAttendanceScore = {
  cycleMonth: string;
  label: string;
  scored: boolean;
  value: number | null;
  band: AttScoreBand | null;
  components: AttScoreComponent[] | null;
  narrative: string | null;
};

/**
 * Score each of `months` (single-cycle) for one employee from days/regs already
 * fetched across the whole window. Each month is scored standalone (cyclesCovered=1),
 * so the LCE quota and the 20-day gate apply per month.
 */
function scoreMonths(emp: EmpRef, days: AttDay[], regDates: Date[], months: string[]): MonthlyAttendanceScore[] {
  const daysByMonth = new Map<string, AttDay[]>();
  for (const d of days) {
    const k = cycleMonthForDate(d.date);
    (daysByMonth.get(k) ?? daysByMonth.set(k, []).get(k)!).push(d);
  }
  const regByMonth = new Map<string, number>();
  for (const dt of regDates) {
    const k = cycleMonthForDate(dt);
    regByMonth.set(k, (regByMonth.get(k) ?? 0) + 1);
  }
  return months.map((m) => {
    const row = buildRow(emp, daysByMonth.get(m) ?? [], regByMonth.get(m) ?? 0, 1);
    const sc = scoreAttendance(row);
    const hasData = row.daysPresent + row.daysHalfDay + row.daysAbsent + row.daysPaidLeave > 0;
    return {
      cycleMonth: m,
      label: monthLabel(m),
      scored: sc.scored,
      value: sc.scored ? sc.score : null,
      band: sc.scored ? sc.band : null,
      components: hasData ? sc.components : null,
      narrative: hasData ? sc.narrative : null,
    };
  });
}

export type AttendanceScoreTrend = {
  /** One entry per month, oldest → newest. */
  months: MonthlyAttendanceScore[];
  /** The newest month with a publishable score — for the headline + feedback. */
  latest: MonthlyAttendanceScore | null;
};

export type AttendanceScorecard = {
  cycleMonth: string;
  /** Rolling window cycle-month keys, oldest → newest (length {@link ROLLING_CYCLES}). */
  cycleMonths: string[];
  /** Wider monthly window for the drill-down, oldest → newest (length {@link TREND_MONTHS}). */
  trendMonths: string[];
  scores: AttendanceScore[];
  /** Scored employees in the "attention" band — the disciplinary follow-up list. */
  flagged: AttendanceScore[];
  /** employeeId → per-month scores over `trendMonths`, for the admin drill-down. */
  monthlyByEmployee: Record<string, MonthlyAttendanceScore[]>;
};

/**
 * Build the full ranked scorecard for the rolling window ending at `cycleMonth`.
 * Owners (MD / Director) have no attendance and are excluded, matching the grid.
 */
export async function loadAttendanceScorecard(cycleMonth: string): Promise<AttendanceScorecard> {
  const cycleMonths = rollingCycleMonths(cycleMonth); // rolling window (3)
  const trendMonths = rollingCycleMonths(cycleMonth, TREND_MONTHS); // wider window (6)
  // Fetch the wider 6-month window once; the rolling score reads the newest 3 of it.
  const fetchStart = cycleWindowForMonth(trendMonths[0]).start;
  const rollingStart = cycleWindowForMonth(cycleMonths[0]).start;
  const end = cycleWindowForMonth(cycleMonth).end;

  const [employeesRaw, days, regs] = await Promise.all([
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
      where: { date: { gte: fetchStart, lte: end } },
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
    prisma.hrAttendanceRegularization.findMany({
      where: { date: { gte: fetchStart, lte: end } },
      select: { employeeId: true, date: true },
    }),
  ]);

  const employees = employeesRaw.filter(
    (e) => !(isOwnerDesignation(e.designationRef?.name) || isOwnerDesignation(e.designation)),
  );

  const daysByEmp = new Map<string, AttDay[]>();
  for (const d of days) (daysByEmp.get(d.employeeId) ?? daysByEmp.set(d.employeeId, []).get(d.employeeId)!).push(d);
  const regDatesByEmp = new Map<string, Date[]>();
  for (const r of regs) (regDatesByEmp.get(r.employeeId) ?? regDatesByEmp.set(r.employeeId, []).get(r.employeeId)!).push(r.date);

  const rows: AttendanceScoreRow[] = [];
  const monthlyByEmployee: Record<string, MonthlyAttendanceScore[]> = {};
  for (const emp of employees) {
    const empDays = daysByEmp.get(emp.id) ?? [];
    const empRegDates = regDatesByEmp.get(emp.id) ?? [];
    // Rolling score: the newest ROLLING_CYCLES cycles only.
    const rollingDays = empDays.filter((d) => d.date >= rollingStart);
    const rollingRegCount = empRegDates.filter((dt) => dt >= rollingStart).length;
    rows.push(buildRow(emp, rollingDays, rollingRegCount, cycleMonths.length));
    // Monthly matrix: every month in the wider window, scored standalone.
    monthlyByEmployee[emp.id] = scoreMonths(emp, empDays, empRegDates, trendMonths);
  }

  const scores = buildAttendanceScorecard(rows);
  const flagged = scores.filter((s) => s.scored && s.band === "attention");

  return { cycleMonth, cycleMonths, trendMonths, scores, flagged, monthlyByEmployee };
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

/**
 * Per-month attendance scores for a single employee — the home-page trend graph.
 * Each of the last `months` cycles is scored standalone; `latest` is the newest
 * scored month, used for the headline + component feedback.
 */
export async function attendanceScoreTrend(
  employeeId: string,
  endCycleMonth: string,
  months = TREND_MONTHS,
): Promise<AttendanceScoreTrend> {
  const monthList = rollingCycleMonths(endCycleMonth, months); // oldest → newest
  const start = cycleWindowForMonth(monthList[0]).start;
  const end = cycleWindowForMonth(endCycleMonth).end;

  const [emp, days, regs] = await Promise.all([
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
    prisma.hrAttendanceRegularization.findMany({
      where: { employeeId, date: { gte: start, lte: end } },
      select: { date: true },
    }),
  ]);

  if (!emp) return { months: [], latest: null };
  const monthly = scoreMonths(emp, days, regs.map((r) => r.date), monthList);
  const latest = [...monthly].reverse().find((m) => m.scored) ?? null;
  return { months: monthly, latest };
}
