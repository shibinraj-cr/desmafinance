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
