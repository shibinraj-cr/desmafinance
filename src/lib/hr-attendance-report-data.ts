import { prisma } from "./prisma";
import { computeLateTags, cycleDates, cycleWindowForMonth } from "./hr-data";
import { isOwnerDesignation, effectiveDesignation } from "./hr-salary-engine";
import { buildAttendanceReport, type AttendanceReport } from "./hr-attendance-report";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Assemble the attendance sheet for one salary cycle (see hr-attendance-report.ts).
 *
 * Employees: everyone on the rolls at any point in the cycle — active staff who
 * joined by the cycle end, plus anyone (even since deactivated) with attendance
 * rows in the window, so a past cycle still lists its leavers. Owners (MD /
 * Director) have no attendance and are left out, as on the Attendance grid.
 * Order matches the grid (emp code).
 */
export async function loadAttendanceReport(monthKey: string): Promise<AttendanceReport> {
  const { start, end } = cycleWindowForMonth(monthKey);
  const dates = cycleDates(monthKey);

  const [days, holidays] = await Promise.all([
    prisma.hrAttendanceDay.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
      select: { id: true, employeeId: true, date: true, status: true, inTime: true, outTime: true, lateMinutes: true },
    }),
    prisma.holiday.findMany({ where: { date: { gte: start, lte: end } }, select: { date: true } }),
  ]);

  const withRows = new Set(days.map((d) => d.employeeId));
  const employeesRaw = await prisma.employee.findMany({
    where: { OR: [{ active: true }, { id: { in: [...withRows] } }] },
    orderBy: { empCode: "asc" },
    select: {
      id: true,
      name: true,
      joinDate: true,
      relievingDate: true,
      halfHourConcession: true,
      designation: true,
      designationRef: { select: { name: true } },
    },
  });
  const employees = employeesRaw.filter((e) => {
    if (isOwnerDesignation(effectiveDesignation(e))) return false;
    if (withRows.has(e.id)) return true;
    if (e.joinDate && iso(e.joinDate) > iso(end)) return false;
    if (e.relievingDate && iso(e.relievingDate) < iso(start)) return false;
    return true;
  });

  const daysByEmployee = new Map<string, typeof days>();
  for (const d of days) {
    const list = daysByEmployee.get(d.employeeId) ?? [];
    list.push(d);
    daysByEmployee.set(d.employeeId, list);
  }

  return buildAttendanceReport({
    dates,
    holidays: new Set(holidays.map((h) => iso(h.date))),
    employees: employees.map((e) => {
      const empDays = daysByEmployee.get(e.id) ?? [];
      // Same per-cycle LCE / AL tagging as the grid and the salary run.
      const { tags } = computeLateTags(empDays, e.halfHourConcession);
      return {
        name: e.name,
        joinDate: e.joinDate,
        relievingDate: e.relievingDate,
        days: empDays.map((d) => ({
          date: d.date,
          status: d.status,
          inTime: d.inTime,
          outTime: d.outTime,
          lateTag: tags.get(d.id) ?? null,
        })),
      };
    }),
  });
}
