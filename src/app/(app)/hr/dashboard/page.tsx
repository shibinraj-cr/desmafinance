import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { CategoryDonut, HeadcountArea, HorizontalBars } from "@/components/Charts";
import { monthLabel } from "@/lib/format";
import { deriveBreakdown, isTraineeDesignation } from "@/lib/hr-salary-engine";
import { cycleMonthForDate, cycleWindowForMonth } from "@/lib/hr-data";
import { loadActiveEmployeeBirthdays, upcomingBirthdays } from "@/lib/hr-birthdays";

export const dynamic = "force-dynamic";

/** Cumulative active-headcount series for the trailing `months`, derived from
 *  join dates (the current active roster, accumulated month by month). */
function buildHeadcountGrowth(joinDates: Date[], now: Date, months = 8) {
  const series: { month: string; count: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    // Last day of the month i months before the current one.
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    const count = joinDates.filter((j) => j.getTime() <= monthEnd.getTime()).length;
    series.push({ month: monthLabel(monthEnd), count });
  }
  return series;
}

export default async function HrDashboardPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="HR" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              You don&apos;t have access to the HR module.
            </div>
          </Section>
        </div>
      </>
    );
  }

  const now = new Date();
  const cycleKey = cycleMonthForDate(now);
  const { start, end } = cycleWindowForMonth(cycleKey);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [activeEmployees, pendingLeaves, todayByStatus, deptBreakdown, empData, allBirthdays] =
    await Promise.all([
      prisma.employee.count({ where: { active: true } }),
      prisma.hrLeaveRequest.count({ where: { status: "pending" } }),
      prisma.hrAttendanceDay.groupBy({
        by: ["status"],
        where: { date: today },
        _count: { _all: true },
      }),
      prisma.hrEmployeeDepartment.groupBy({
        by: ["departmentId"],
        where: { isPrimary: true },
        _count: { employeeId: true },
      }),
      prisma.employee.findMany({
        where: { active: true },
        select: {
          joinDate: true,
          designation: true,
          designationRef: { select: { name: true } },
          departments: { where: { isPrimary: true }, select: { departmentId: true } },
          salaryStructures: {
            where: { effectiveFrom: { lte: today } },
            orderBy: { effectiveFrom: "desc" },
            take: 1,
            select: {
              basic: true,
              hraPct: true,
              conveyancePct: true,
              medicalPct: true,
              specialPct: true,
            },
          },
        },
      }),
      loadActiveEmployeeBirthdays(),
    ]);

  const deptRows = await prisma.hrDepartment.findMany({
    where: { id: { in: deptBreakdown.map((d) => d.departmentId) } },
    select: { id: true, name: true },
  });
  const deptNameById = new Map(deptRows.map((d) => [d.id, d.name]));

  // ---- KPI: attendance today --------------------------------------------
  const statusCount = (s: string) =>
    todayByStatus.find((r) => r.status === s)?._count._all ?? 0;
  const present = statusCount("P") + statusCount("OD") + statusCount("REG");
  const halfDay = statusCount("HD");
  const onLeave = statusCount("LV");
  const absent = statusCount("A");
  const presentToday = present + halfDay;
  const attendancePct = activeEmployees > 0 ? Math.round((presentToday / activeEmployees) * 100) : 0;
  const attendanceData = [
    { name: "Present", value: presentToday },
    { name: "On leave", value: onLeave },
    { name: "Absent", value: absent },
  ].filter((d) => d.value > 0);
  const hasAttendanceToday = attendanceData.length > 0;

  // ---- Avg CTC + monthly salary cost by department ----------------------
  let ctcSum = 0;
  let ctcCount = 0;
  const salaryByDeptId = new Map<string, number>();
  for (const e of empData) {
    const s = e.salaryStructures[0];
    if (!s) continue;
    // Trainees are paid on basic only — don't count allowances in CTC roll-ups.
    const isTrainee =
      isTraineeDesignation(e.designationRef?.name) || isTraineeDesignation(e.designation);
    const gross = deriveBreakdown(Number(s.basic), {
      hraPct: isTrainee ? 0 : Number(s.hraPct),
      conveyancePct: isTrainee ? 0 : Number(s.conveyancePct),
      medicalPct: isTrainee ? 0 : Number(s.medicalPct),
      specialPct: isTrainee ? 0 : Number(s.specialPct),
    }).gross;
    ctcSum += gross * 12;
    ctcCount += 1;
    const deptId = e.departments[0]?.departmentId;
    if (deptId) salaryByDeptId.set(deptId, (salaryByDeptId.get(deptId) ?? 0) + gross);
  }
  const avgCtc = ctcCount > 0 ? Math.round(ctcSum / ctcCount) : null;

  const headcountByDept = deptBreakdown
    .map((d) => ({ name: deptNameById.get(d.departmentId) ?? "—", value: d._count.employeeId }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 7);

  const salaryByDept = [...salaryByDeptId.entries()]
    .map(([id, value]) => ({ name: deptNameById.get(id) ?? "—", value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 7);

  // ---- Headcount growth + trend -----------------------------------------
  const growth = buildHeadcountGrowth(
    empData.map((e) => e.joinDate).filter((d): d is Date => d !== null),
    now,
  );
  const lastCount = growth[growth.length - 1]?.count ?? 0;
  const prevCount = growth[growth.length - 2]?.count ?? 0;
  const headcountTrend = prevCount > 0 ? ((lastCount - prevCount) / prevCount) * 100 : null;

  const upcoming = upcomingBirthdays(allBirthdays, 7);
  const todaysBdays = upcoming.filter((u) => u.delta === 0);
  const futureBdays = upcoming.filter((u) => u.delta > 0);

  return (
    <>
      <TopBar
        title="HR Dashboard"
        subtitle={`Cycle ${cycleKey} · ${start.toISOString().slice(5, 10)} → ${end.toISOString().slice(5, 10)}`}
      />
      <div className="p-margin space-y-lg">
        {/* KPI row */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-gutter">
          <KpiCard
            dark
            hero
            label="Headcount"
            value={String(activeEmployees)}
            hint="Active employees"
            trendPct={headcountTrend}
          />
          <KpiCard
            label="Present today"
            value={String(presentToday)}
            hint={hasAttendanceToday ? `${attendancePct}% attendance` : "No attendance yet"}
            tone="success"
          />
          <KpiCard label="On leave" value={String(onLeave)} hint="Today" />
          <KpiCard
            label="Pending leave"
            value={String(pendingLeaves)}
            hint="Awaiting approval"
            tone={pendingLeaves > 0 ? "primary" : "default"}
          />
          <KpiCard
            label="Avg CTC"
            value={avgCtc ?? "—"}
            hint="Per annum"
            tone="primary"
          />
        </section>

        {/* Headcount by department · Attendance today */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
          <Section
            title="Headcount by department"
            className="lg:col-span-7"
            action={
              <Link href="/hr/employees" className="text-label-sm underline text-on-surface-variant">
                Employees
              </Link>
            }
          >
            {headcountByDept.length === 0 ? (
              <p className="py-md text-center text-on-surface-variant text-label-sm">
                No departments configured.
              </p>
            ) : (
              <HorizontalBars data={headcountByDept} valueKind="count" />
            )}
          </Section>

          <Section title="Attendance today" className="lg:col-span-5">
            {hasAttendanceToday ? (
              <CategoryDonut
                data={attendanceData}
                centerValue={`${presentToday}/${activeEmployees}`}
                centerLabel="Present"
                valueKind="count"
              />
            ) : (
              <p className="py-lg text-center text-on-surface-variant text-label-sm">
                No attendance uploaded for today yet.
              </p>
            )}
          </Section>
        </section>

        {/* Monthly salary cost by department · Headcount growth */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
          <Section
            title="Monthly salary cost by department"
            className="lg:col-span-7"
            action={
              <Link href="/hr/salary" className="text-label-sm underline text-on-surface-variant">
                Payroll
              </Link>
            }
          >
            {salaryByDept.length === 0 ? (
              <p className="py-md text-center text-on-surface-variant text-label-sm">
                No salary structures on file yet.
              </p>
            ) : (
              <HorizontalBars data={salaryByDept} />
            )}
          </Section>

          <Section title="Headcount growth" className="lg:col-span-5">
            <HeadcountArea data={growth} />
          </Section>
        </section>

        {/* Birthdays · Quick links */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
          <Section
            title="Birthdays this week"
            className="lg:col-span-5"
            action={
              <Link href="/hr/birthdays" className="text-label-sm underline text-on-surface-variant">
                Calendar
              </Link>
            }
          >
            {todaysBdays.length > 0 && (
              <div className="mb-base p-sm bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-label-sm font-bold mb-xs">Today</p>
                {todaysBdays.map((b) => (
                  <p key={b.id} className="text-label-sm">
                    <strong>{b.name}</strong> — turning {b.ageThisYear}
                  </p>
                ))}
              </div>
            )}
            {futureBdays.length === 0 && todaysBdays.length === 0 ? (
              <p className="text-on-surface-variant text-label-sm py-md text-center">
                No birthdays in the next 7 days.
              </p>
            ) : (
              <ul className="space-y-xs">
                {futureBdays.map((b) => (
                  <li key={b.id} className="flex items-center gap-sm">
                    <span className="text-h3 font-extrabold tabular-nums w-12">{b.dob.slice(5)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-label-sm font-semibold truncate">{b.name}</p>
                      <p className="text-caption text-on-surface-variant truncate">
                        {b.designation ?? "—"}
                      </p>
                    </div>
                    <span className="text-caption text-on-surface-variant">in {b.delta}d</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Quick links" className="lg:col-span-7">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-sm">
              {[
                { href: "/hr/attendance", icon: "fact_check", label: "Upload attendance" },
                { href: "/hr/salary", icon: "calculate", label: "Run salary" },
                { href: "/hr/leave-review", icon: "rule", label: "Review leaves" },
                { href: "/hr/regularization", icon: "edit_calendar", label: "Regularizations" },
                { href: "/hr/shift-assignments", icon: "schedule_send", label: "Shift assignments" },
                { href: "/hr/leave-eligibility", icon: "savings", label: "Leave eligibility" },
                { href: "/hr/birthdays", icon: "cake", label: "Birthday calendar" },
                { href: "/hr/policies", icon: "menu_book", label: "Publish policy" },
                { href: "/hr/holidays", icon: "event", label: "Holiday calendar" },
              ].map((q) => (
                <Link
                  key={q.href}
                  href={q.href}
                  className="flex items-center gap-sm px-md py-sm rounded-lg border border-outline-variant hover:bg-surface-container transition text-on-surface"
                >
                  <span className="material-symbols-outlined">{q.icon}</span>
                  <span className="text-label-sm">{q.label}</span>
                </Link>
              ))}
            </div>
          </Section>
        </section>
      </div>
    </>
  );
}
