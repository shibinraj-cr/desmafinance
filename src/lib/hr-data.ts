import { prisma } from "./prisma";

export type EmployeeListRow = {
  id: string;
  empCode: string;
  name: string;
  designation: string | null;
  department: string | null;
  shiftName: string | null;
  shiftCode: string | null;
  email: string | null;
  officialEmail: string | null;
  phone: string | null;
  joinDate: Date | null;
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  branch: string | null;
  halfHourConcession: boolean;
  active: boolean;
  userId: string | null;
  hasCurrentStructure: boolean;
};

export async function loadEmployees(): Promise<EmployeeListRow[]> {
  const rows = await prisma.employee.findMany({
    orderBy: [{ active: "desc" }, { joinDate: "asc" }, { name: "asc" }],
    include: { shift: true, salaryStructures: { take: 1, orderBy: { effectiveFrom: "desc" } } },
  });
  return rows.map((e) => ({
    id: e.id,
    empCode: e.empCode,
    name: e.name,
    designation: e.designation,
    department: e.department,
    shiftName: e.shift?.name ?? null,
    shiftCode: e.shift?.code ?? null,
    email: e.email,
    officialEmail: e.officialEmail,
    phone: e.phone,
    joinDate: e.joinDate,
    bankName: e.bankName,
    accountNumber: e.accountNumber,
    ifsc: e.ifsc,
    branch: e.branch,
    halfHourConcession: e.halfHourConcession,
    active: e.active,
    userId: e.userId,
    hasCurrentStructure: e.salaryStructures.length > 0,
  }));
}

export async function loadShifts() {
  return prisma.hrShift.findMany({ orderBy: { code: "asc" } });
}

/** Parse a "23rd July  2023" style date string into a Date. Returns null on miss. */
export function parseHumanDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = String(input).trim().replace(/\s+/g, " ");
  if (!s) return null;
  const cleaned = s.replace(/(\d+)(st|nd|rd|th)/i, "$1");
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const dd = +m[1];
    const mm = +m[2] - 1;
    let yy = +m[3];
    if (yy < 100) yy += 2000;
    const out = new Date(Date.UTC(yy, mm, dd));
    if (!isNaN(out.getTime())) return out;
  }
  return null;
}

/** Resolve the structure that should apply for a given month (YYYY-MM). */
export async function structureForMonth(employeeId: string, monthKey: string) {
  const [yStr, mStr] = monthKey.split("-");
  const year = +yStr;
  const month = +mStr;
  const monthEnd = new Date(Date.UTC(year, month, 0));
  // 1. Newest structure that takes effect on or before the month end.
  const historic = await prisma.hrSalaryStructure.findFirst({
    where: { employeeId, effectiveFrom: { lte: monthEnd } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (historic) return historic;
  // 2. Fallback for back-running payroll: use the earliest structure
  //    on file even if its effectiveFrom is later than the run month.
  //    This lets HR run March/April payroll after entering current
  //    structures, without first having to backdate every row.
  return prisma.hrSalaryStructure.findFirst({
    where: { employeeId },
    orderBy: { effectiveFrom: "asc" },
  });
}

export function monthKeyFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function parseMonthKey(monthKey: string): { year: number; month: number; start: Date; end: Date } {
  const [y, m] = monthKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { year: y, month: m, start, end };
}

/**
 * Company salary cycle window for a given cycle-month key.
 *
 * Salary cycle runs **26th of previous month → 25th of current month**.
 * Example: monthKey "2026-04" → 2026-03-26 to 2026-04-25.
 *
 * This is the canonical attendance + payroll window. Use it everywhere
 * we'd previously have used `parseMonthKey` for an attendance lookup.
 */
export function cycleWindowForMonth(monthKey: string): {
  year: number;
  month: number;
  start: Date;
  end: Date;
} {
  const [y, m] = monthKey.split("-").map(Number);
  // start = 26th of (m-1). If m=1 (Jan), prev = Dec of (y-1).
  const startYear = m === 1 ? y - 1 : y;
  const startMonth = m === 1 ? 12 : m - 1;
  const start = new Date(Date.UTC(startYear, startMonth - 1, 26));
  // End at the start of the 25th UTC — attendance rows are stored as
  // midnight UTC (date-only), so an inclusive 25 UTC == 25 UTC query
  // works and avoids any TZ-driven "rollover to the 26th" display bug.
  const end = new Date(Date.UTC(y, m - 1, 25));
  return { year: y, month: m, start, end };
}

/**
 * Given a date, return the cycle monthKey that the date belongs to.
 * Day-of-month ≤ 25 → same calendar month; ≥ 26 → next calendar month.
 */
export function cycleMonthForDate(date: Date): string {
  const day = date.getUTCDate();
  let y = date.getUTCFullYear();
  let m = date.getUTCMonth() + 1;
  if (day >= 26) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Total number of days in a salary cycle (28-31). */
export function cycleDayCount(monthKey: string): number {
  const { start, end } = cycleWindowForMonth(monthKey);
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

/** Returns the array of UTC dates in a cycle (start..end inclusive). */
export function cycleDates(monthKey: string): Date[] {
  const { start, end } = cycleWindowForMonth(monthKey);
  const dates: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Late-Coming Eligibility (LCE) policy:
 *   eligible employees can arrive up to GRACE_MINUTES late on up to
 *   GRACE_DAYS days per salary cycle (26th → 25th).
 * Days within the grace are tagged "LCE"; everything else with late > 0
 * is tagged "AL" (Arrived Late).
 */
export const LCE_GRACE_MINUTES = 30;
export const LCE_GRACE_DAYS = 3;

export type LateTag = "LCE" | "AL" | null;

/**
 * Compute LCE / AL tags for one employee's days within a cycle.
 * Walks days in chronological order, consumes the LCE quota greedily.
 *
 * - status WO / HL / A / LV → no tag (didn't work that day)
 * - status P / HD + late ≤ 0 → no tag
 * - eligible + late ≤ 30m + quota left → "LCE" (consume one)
 * - everything else with late > 0 → "AL"
 */
export function computeLateTags(
  days: { id: string; date: Date; lateMinutes: number | null; status: string }[],
  eligible: boolean,
): {
  tags: Map<string, LateTag>;
  lceUsed: number;
  alCount: number;
} {
  const tags = new Map<string, LateTag>();
  let lceUsed = 0;
  let alCount = 0;
  const sorted = [...days].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const d of sorted) {
    const late = d.lateMinutes ?? 0;
    if (late <= 0) {
      tags.set(d.id, null);
      continue;
    }
    // Only late-from-work days count — being late while absent / on leave / off
    // is not a concept.
    if (d.status !== "P" && d.status !== "HD") {
      tags.set(d.id, null);
      continue;
    }
    if (eligible && late <= LCE_GRACE_MINUTES && lceUsed < LCE_GRACE_DAYS) {
      tags.set(d.id, "LCE");
      lceUsed++;
    } else {
      tags.set(d.id, "AL");
      alCount++;
    }
  }
  return { tags, lceUsed, alCount };
}

export const ATT_STATUS = {
  PRESENT: "P",
  ABSENT: "A",
  WEEK_OFF: "WO",
  HOLIDAY: "HL",
  LEAVE: "LV",
  HALF_DAY: "HD",
} as const;

export function normaliseAttendanceStatus(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return "A";
  if (s === "P" || s === "P ") return "P";
  if (s === "A") return "A";
  if (s === "WO" || s === "S" || s === "SUN" || s === "SUNDAY") return "WO";
  if (s === "HL" || s === "H" || s === "HOL") return "HL";
  if (s === "LV" || s === "L" || s === "CL" || s === "SL" || s === "PL") return "LV";
  if (s === "HD" || s === "1/2" || s === "0.5") return "HD";
  return s;
}
