import { prisma } from "./prisma";

/** Resolve the Employee record for the signed-in DESGRO user, or null. */
export async function employeeForUser(userId: string) {
  return prisma.employee.findUnique({
    where: { userId },
    include: {
      shift: true,
      leaveBalances: { orderBy: { year: "desc" }, take: 1 },
    },
  });
}

/** Count business days (Mon–Sat) inclusive between two dates, skipping HR holidays. */
export async function countBusinessDays(from: Date, to: Date): Promise<number> {
  if (to < from) return 0;
  const holidays = await prisma.hrHoliday.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
  let count = 0;
  const cur = new Date(from);
  while (cur <= to) {
    const dow = cur.getUTCDay();
    const key = cur.toISOString().slice(0, 10);
    if (dow !== 0 && !holidaySet.has(key)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}
