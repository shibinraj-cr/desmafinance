import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { cycleMonthForDate, cycleWindowForMonth } from "@/lib/hr-data";
import { attendanceScoreForEmployee } from "@/lib/hr-attendance-score-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/attendance?month=YYYY-MM — the signed-in employee's attendance for
 * one payroll cycle: per-day rows (status/in/out/work/late), status counts, and
 * the rolling behaviour score. Mirrors the /me/attendance server page query.
 */
export async function GET(req: Request) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);
  if (!emp) return NextResponse.json({ employee: null, month: null, counts: {}, days: [], score: null });

  const sp = new URL(req.url).searchParams;
  const monthParam = sp.get("month");
  const monthKey =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : cycleMonthForDate(new Date());
  const { start, end } = cycleWindowForMonth(monthKey);

  const [days, score] = await Promise.all([
    prisma.hrAttendanceDay.findMany({
      where: { employeeId: emp.id, date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
    }),
    attendanceScoreForEmployee(emp.id, monthKey),
  ]);

  const counts = days.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    month: monthKey,
    counts,
    days: days.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      status: d.status,
      shiftCode: d.shiftCode,
      inTime: d.inTime,
      outTime: d.outTime,
      workMinutes: d.workMinutes,
      lateMinutes: d.lateMinutes,
      otMinutes: d.otMinutes,
      remark: d.remark,
    })),
    score:
      score && score.scored
        ? { score: score.score, band: score.band, bandLabel: score.bandLabel, narrative: score.narrative }
        : null,
  });
}
