import { prisma } from "./prisma";

/** Resolve the Employee record for the signed-in DESGRO user, or null. */
export async function employeeForUser(userId: string) {
  return prisma.employee.findUnique({
    where: { userId },
    include: {
      shift: true,
      designationRef: { select: { name: true } },
      leaveBalances: { orderBy: { year: "desc" }, take: 1 },
    },
  });
}

/**
 * The business days (Mon–Sat, minus HR holidays) inclusive between two dates.
 *
 * A planned leave is stored as ONE row spanning a range; approving it writes an
 * attendance day per working day in that range. This returns exactly those days,
 * so the fan-out never charges an employee for a Sunday or a published holiday
 * sitting inside their leave.
 */
export async function businessDaysBetween(from: Date, to: Date): Promise<Date[]> {
  if (to < from) return [];
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
  const out: Date[] = [];
  const cur = new Date(from);
  while (cur <= to) {
    const key = cur.toISOString().slice(0, 10);
    if (cur.getUTCDay() !== 0 && !holidaySet.has(key)) out.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Count business days (Mon–Sat) inclusive between two dates, skipping HR holidays. */
export async function countBusinessDays(from: Date, to: Date): Promise<number> {
  return (await businessDaysBetween(from, to)).length;
}
