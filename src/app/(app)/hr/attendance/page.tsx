import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { isOwnerDesignation } from "@/lib/hr-salary-engine";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import {
  cycleWindowForMonth,
  cycleDates,
  monthKeyFromDate,
  cycleMonthForDate,
  computeLateTags,
  LCE_GRACE_DAYS,
  LCE_GRACE_MINUTES,
  type LateTag,
} from "@/lib/hr-data";
import { computeMonthlyLeaveLedger, paidLeaveCoveredByDay } from "@/lib/hr-leave-balance";
import { AttendanceClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HrAttendancePage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Attendance" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }

  const today = new Date();
  const requested =
    searchParams?.month && /^\d{4}-\d{2}$/.test(searchParams.month)
      ? searchParams.month
      : cycleMonthForDate(today);
  const { start, end } = cycleWindowForMonth(requested);
  const dates = cycleDates(requested);

  const [uploads, days, employeesRaw] = await Promise.all([
    prisma.hrAttendanceUpload.findMany({
      where: { monthKey: requested },
      orderBy: { uploadedAt: "desc" },
      take: 5,
      include: { uploadedBy: { select: { username: true } } },
    }),
    prisma.hrAttendanceDay.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: [{ employeeId: "asc" }, { date: "asc" }],
      include: { employee: { select: { empCode: true, name: true } } },
    }),
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
  ]);
  // Owners (MD / Director) have no attendance — exclude them from the grid.
  const employees = employeesRaw.filter(
    (e) => !(isOwnerDesignation(e.designationRef?.name) || isOwnerDesignation(e.designation)),
  );

  const grid: Record<
    string,
    Record<
      string,
      {
        status: string;
        in: string | null;
        out: string | null;
        work: number | null;
        ot: number | null;
        late: number | null;
        remark: string | null;
        lateTag: LateTag;
        paid: number; // paid-leave portion of this day covered by the allocation (0 / 0.5 / 1)
      }
    >
  > = {};
  const summary: Record<
    string,
    // PL = paid-leave days covering loss-of-pay this cycle; Unpaid = LOP − PL.
    { P: number; HD: number; A: number; WO: number; HL: number; LV: number; LCE: number; AL: number; PL: number }
  > = {};

  // Compute LCE/AL tags per employee from the days in this cycle.
  const tagsByDayId = new Map<string, LateTag>();
  for (const emp of employees) {
    const empDays = days.filter((d) => d.employeeId === emp.id);
    const { tags } = computeLateTags(empDays, emp.halfHourConcession);
    for (const [dayId, tag] of tags) tagsByDayId.set(dayId, tag);
  }

  for (const d of days) {
    const key = d.date.toISOString().slice(0, 10);
    const lateTag = tagsByDayId.get(d.id) ?? null;
    grid[d.employeeId] ??= {};
    grid[d.employeeId][key] = {
      status: d.status,
      in: d.inTime,
      out: d.outTime,
      work: d.workMinutes,
      ot: d.otMinutes,
      late: d.lateMinutes,
      remark: d.remark,
      lateTag,
      paid: 0,
    };
    summary[d.employeeId] ??= { P: 0, HD: 0, A: 0, WO: 0, HL: 0, LV: 0, LCE: 0, AL: 0, PL: 0 };
    // A present day flagged AL (late beyond the allowance) is docked as a
    // half-day in payroll, so count it as HD here too — keeps the grid summary
    // consistent with the salary run (LCE days are not penalised).
    const isAlHalf = d.status === "P" && lateTag === "AL";
    const k = (isAlHalf ? "HD" : d.status) as keyof (typeof summary)[string];
    if (k in summary[d.employeeId]) (summary[d.employeeId][k] as number)++;
    if (lateTag === "LCE") summary[d.employeeId].LCE++;
    else if (lateTag === "AL") summary[d.employeeId].AL++;
  }
  // Ensure every employee has a summary row even if no days
  for (const emp of employees) {
    summary[emp.id] ??= { P: 0, HD: 0, A: 0, WO: 0, HL: 0, LV: 0, LCE: 0, AL: 0, PL: 0 };
  }

  // Paid-leave coverage: how much of this cycle's loss-of-pay each employee's
  // monthly paid-leave allocation covers (earliest-first, carry-forward). Read
  // from the canonical ledger so the grid matches the Leave tab and payroll, then
  // mark the specific covered days.
  const [cycleYear, cycleMonthIdx] = requested.split("-").map(Number);
  await Promise.all(
    employees.map(async (emp) => {
      const { rows } = await computeMonthlyLeaveLedger(emp.id, cycleYear, { fill: "full" });
      const covered = rows.find((r) => r.month === cycleMonthIdx)?.covered ?? 0;
      summary[emp.id].PL = covered;
      if (covered <= 0) return;
      const empDays = days.filter((d) => d.employeeId === emp.id);
      const paidMap = paidLeaveCoveredByDay(empDays, emp.halfHourConcession, covered);
      for (const d of empDays) {
        const portion = paidMap.get(d.id);
        if (!portion) continue;
        const cell = grid[emp.id]?.[d.date.toISOString().slice(0, 10)];
        if (cell) cell.paid = portion;
      }
    }),
  );

  const dateCells = dates.map((d) => ({
    iso: d.toISOString().slice(0, 10),
    day: d.getUTCDate(),
    month: d.getUTCMonth() + 1,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()],
  }));

  // Use timeZone: UTC so display matches the stored date (the end date
  // is stored as 25 23:59:59 UTC; without UTC formatting, IST would
  // show it as the 26th).
  const cycleLabel = `${start.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })} → ${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`;

  // Compute prev / next cycle for navigation
  const [yStr, mStr] = requested.split("-").map(Number);
  const prevMonth = mStr === 1 ? `${yStr - 1}-12` : `${yStr}-${String(mStr - 1).padStart(2, "0")}`;
  const nextMonth = mStr === 12 ? `${yStr + 1}-01` : `${yStr}-${String(mStr + 1).padStart(2, "0")}`;

  return (
    <>
      <TopBar
        title="Attendance"
        subtitle={`Cycle ${requested} · ${cycleLabel} · ${dates.length} days`}
      />
      <div className="p-margin space-y-lg">
        <AttendanceClient
          monthKey={requested}
          prevMonth={prevMonth}
          nextMonth={nextMonth}
          cycleLabel={cycleLabel}
          dateCells={dateCells}
          canUpload={canApproveHr(perms)}
          uploads={uploads.map((u) => ({
            id: u.id,
            filename: u.filename ?? "(no filename)",
            rowCount: u.rowCount,
            uploadedAt: u.uploadedAt.toISOString(),
            uploadedBy: u.uploadedBy?.username ?? "—",
          }))}
          employees={employees.map((e) => ({
            id: e.id,
            empCode: e.empCode,
            name: e.name,
            lateEligible: e.halfHourConcession,
          }))}
          grid={grid}
          summary={summary}
          lceGraceDays={LCE_GRACE_DAYS}
          lceGraceMinutes={LCE_GRACE_MINUTES}
        />
      </div>
    </>
  );
}
