import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { cycleMonthForDate, cycleWindowForMonth, monthKeyFromDate } from "@/lib/hr-data";
import { loadActiveEmployeeBirthdays, upcomingBirthdays } from "@/lib/hr-birthdays";

export const dynamic = "force-dynamic";

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
  const monthKey = monthKeyFromDate(now);
  const cycleKey = cycleMonthForDate(now);
  const { start, end } = cycleWindowForMonth(cycleKey);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [
    employeesTotal,
    activeEmployees,
    pendingLeaves,
    currentRun,
    openPolicies,
    pendingRegularizations,
    pendingShiftChanges,
    todayPresent,
    todayAbsent,
    todayLate,
    deptBreakdown,
    shiftBreakdown,
    leaveAccruals30,
    allBirthdays,
  ] = await Promise.all([
    prisma.employee.count(),
    prisma.employee.count({ where: { active: true } }),
    prisma.hrLeaveRequest.count({ where: { status: "pending" } }),
    prisma.hrSalaryRun.findUnique({ where: { monthKey } }),
    prisma.hrPolicy.count({ where: { status: "published" } }),
    prisma.hrAttendanceRegularization.count({ where: { status: "pending" } }),
    prisma.hrShiftAssignment.count({ where: { status: "pending" } }),
    prisma.hrAttendanceDay.count({
      where: { date: today, status: { in: ["P", "HD", "OD", "REG"] } },
    }),
    prisma.hrAttendanceDay.count({
      where: { date: today, status: "A" },
    }),
    prisma.hrAttendanceDay.count({
      where: { date: today, lateMinutes: { gt: 10 }, status: { in: ["P", "HD"] } },
    }),
    prisma.hrEmployeeDepartment.groupBy({
      by: ["departmentId"],
      where: { isPrimary: true },
      _count: { employeeId: true },
    }),
    prisma.employee.groupBy({
      by: ["shiftId"],
      where: { active: true },
      _count: { id: true },
    }),
    prisma.hrLeaveAccrual.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { employee: { select: { empCode: true, name: true } } },
    }),
    loadActiveEmployeeBirthdays(),
  ]);

  const upcoming = upcomingBirthdays(allBirthdays, 7);
  const todaysBdays = upcoming.filter((u) => u.delta === 0);

  const [deptRows, shiftRows] = await Promise.all([
    prisma.hrDepartment.findMany({
      where: { id: { in: deptBreakdown.map((d) => d.departmentId) } },
      select: { id: true, name: true },
    }),
    prisma.hrShift.findMany({
      where: { id: { in: shiftBreakdown.map((s) => s.shiftId).filter((x): x is string => !!x) } },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const deptNameById = new Map(deptRows.map((d) => [d.id, d.name]));
  const shiftNameById = new Map(shiftRows.map((s) => [s.id, `${s.code} · ${s.name}`]));

  const tiles: { label: string; value: string | number; href: string; icon: string; tone?: string }[] = [
    { label: "Active Employees", value: activeEmployees, href: "/hr/employees", icon: "groups" },
    { label: "Present today", value: todayPresent, href: "/hr/attendance", icon: "check_circle", tone: "success" },
    { label: "Absent today", value: todayAbsent, href: "/hr/leave-review", icon: "cancel", tone: "danger" },
    { label: "Late today", value: todayLate, href: "/hr/leave-review", icon: "schedule", tone: "warn" },
    { label: "Pending leaves", value: pendingLeaves, href: "/hr/leave", icon: "event_busy" },
    { label: "Regularizations", value: pendingRegularizations, href: "/hr/regularization", icon: "edit_calendar", tone: pendingRegularizations > 0 ? "warn" : undefined },
    { label: "Shift changes", value: pendingShiftChanges, href: "/hr/shift-assignments?status=pending", icon: "schedule_send" },
    { label: `Salary Run ${monthKey}`, value: currentRun ? currentRun.status.replace("_", " ") : "Not started", href: "/hr/salary", icon: "payments" },
    { label: "Published Policies", value: openPolicies, href: "/hr/policies", icon: "menu_book" },
    { label: "Master strength", value: employeesTotal, href: "/hr/employees", icon: "person" },
  ];

  return (
    <>
      <TopBar
        title="HR Dashboard"
        subtitle={`Cycle ${cycleKey} · ${start.toISOString().slice(5, 10)} → ${end.toISOString().slice(5, 10)}`}
      />
      <div className="p-margin space-y-lg">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-base">
          {tiles.map((t) => (
            <Link
              key={t.label}
              href={t.href}
              className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg shadow-sm hover:shadow-md transition flex flex-col gap-sm"
            >
              <div className="flex items-center gap-sm text-on-surface-variant">
                <span className="material-symbols-outlined">{t.icon}</span>
                <span className="text-label-sm uppercase tracking-wider">{t.label}</span>
              </div>
              <span
                className={`text-h2 font-extrabold ${t.tone === "danger" ? "text-error" : t.tone === "warn" ? "text-yellow-700" : t.tone === "success" ? "text-green-700" : "text-on-surface"}`}
              >
                {t.value}
              </span>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-base">
          <Section
            title="Birthdays this week"
            action={
              <Link href="/hr/birthdays" className="text-label-sm underline text-on-surface-variant">
                Calendar
              </Link>
            }
            className="lg:col-span-1"
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
            {upcoming.filter((u) => u.delta > 0).length === 0 && todaysBdays.length === 0 ? (
              <p className="text-on-surface-variant text-label-sm py-md text-center">
                No birthdays in the next 7 days.
              </p>
            ) : (
              <ul className="space-y-xs">
                {upcoming
                  .filter((u) => u.delta > 0)
                  .map((b) => (
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

          <Section title="Department breakdown" className="lg:col-span-1">
            {deptBreakdown.length === 0 ? (
              <p className="py-md text-center text-on-surface-variant text-label-sm">
                No departments configured.
              </p>
            ) : (
              <ul className="space-y-xs">
                {deptBreakdown
                  .sort((a, b) => b._count.employeeId - a._count.employeeId)
                  .slice(0, 10)
                  .map((d) => (
                    <li key={d.departmentId} className="flex items-center justify-between">
                      <span className="text-label-sm">{deptNameById.get(d.departmentId) ?? "—"}</span>
                      <span className="font-bold tabular-nums">{d._count.employeeId}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Section>

          <Section title="Shift-wise workforce" className="lg:col-span-1">
            {shiftBreakdown.length === 0 ? (
              <p className="py-md text-center text-on-surface-variant text-label-sm">
                No shifts assigned yet.
              </p>
            ) : (
              <ul className="space-y-xs">
                {shiftBreakdown
                  .sort((a, b) => b._count.id - a._count.id)
                  .map((s) => (
                    <li key={s.shiftId ?? "none"} className="flex items-center justify-between">
                      <span className="text-label-sm">
                        {s.shiftId ? shiftNameById.get(s.shiftId) ?? "—" : "(unassigned)"}
                      </span>
                      <span className="font-bold tabular-nums">{s._count.id}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Section>
        </div>

        <Section title="Recent leave-ledger activity">
          {leaveAccruals30.length === 0 ? (
            <p className="text-on-surface-variant text-label-sm py-md text-center">
              No accruals or adjustments in the last 30 days.
            </p>
          ) : (
            <table className="w-full text-label-sm">
              <thead className="text-on-surface-variant text-caption uppercase tracking-wider">
                <tr>
                  <th className="text-left py-xs">When</th>
                  <th className="text-left py-xs">Employee</th>
                  <th className="text-left py-xs">Period</th>
                  <th className="text-left py-xs">Source</th>
                  <th className="text-right py-xs">Δ days</th>
                </tr>
              </thead>
              <tbody>
                {leaveAccruals30.map((a) => (
                  <tr key={a.id} className="border-t border-outline-variant">
                    <td className="py-xs text-on-surface-variant">
                      {a.createdAt.toLocaleDateString("en-IN")}
                    </td>
                    <td className="py-xs">
                      <span className="font-semibold">{a.employee.empCode}</span> · {a.employee.name}
                    </td>
                    <td className="py-xs">{a.periodKey}</td>
                    <td className="py-xs">{a.source}</td>
                    <td
                      className={`py-xs text-right font-bold ${Number(a.delta) < 0 ? "text-error" : "text-green-700"}`}
                    >
                      {Number(a.delta) > 0 ? "+" : ""}
                      {Number(a.delta).toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Quick links">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-sm">
            {[
              { href: "/hr/attendance", icon: "fact_check", label: "Upload attendance" },
              { href: "/hr/salary", icon: "calculate", label: "Run salary" },
              { href: "/hr/leave-review", icon: "rule", label: "Review leaves" },
              { href: "/hr/regularization", icon: "edit_calendar", label: "Regularizations" },
              { href: "/hr/shift-assignments", icon: "schedule_send", label: "Shift assignments" },
              { href: "/hr/leave-eligibility", icon: "savings", label: "Leave eligibility" },
              { href: "/hr/sandwich-policy", icon: "rule_settings", label: "Sandwich policy" },
              { href: "/hr/birthdays", icon: "cake", label: "Birthday calendar" },
              { href: "/hr/policies", icon: "menu_book", label: "Publish policy" },
              { href: "/hr/trainings", icon: "school", label: "Create training" },
              { href: "/hr/holidays", icon: "event", label: "Holiday calendar" },
              { href: "/hr/shifts", icon: "schedule", label: "Shifts" },
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
      </div>
    </>
  );
}
