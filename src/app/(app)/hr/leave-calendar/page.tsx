import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { isOwnerDesignation } from "@/lib/hr-salary-engine";
import { LeaveCalendarClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Who is off, and when.
 *
 * An approver had no way to see this. They decided each request in isolation,
 * with no view of who else was already away on those dates, so a clash could
 * only be discovered after both had been approved.
 *
 * Deliberately a CALENDAR-month view rather than the 26th-to-25th salary cycle
 * the rest of HR runs on: this answers "who is off next week", a planning
 * question, not a payroll one.
 *
 * Two sources, because leave lives in two places depending on how far along it
 * is. A decided leave day is written onto the attendance row (LV, or HD for a
 * half day). Leave that is still planned or awaiting a decision exists only as
 * a request, which is exactly the leave an approver most needs to see.
 */
export default async function LeaveCalendarPage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Leave Calendar" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }

  const now = new Date();
  const requested =
    searchParams?.month && /^\d{4}-\d{2}$/.test(searchParams.month)
      ? searchParams.month
      : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [year, month] = requested.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  const [employees, leaveDays, requests, holidays] = await Promise.all([
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { empCode: "asc" },
      select: { id: true, empCode: true, name: true, designation: true, designationRef: { select: { name: true } } },
    }),
    // Already decided and written onto the day.
    prisma.hrAttendanceDay.findMany({
      where: { date: { gte: start, lte: end }, status: { in: ["LV", "HD"] } },
      select: { employeeId: true, date: true, status: true, halfSession: true },
    }),
    // Still a request — planned ahead, or waiting on a decision.
    prisma.hrAttendanceRegularization.findMany({
      where: {
        requestType: "leave",
        status: { in: ["pending", "clarification", "approved"] },
        date: { lte: end },
      },
      select: { employeeId: true, date: true, toDate: true, status: true, halfSession: true },
    }),
    prisma.holiday.findMany({ where: { date: { gte: start, lte: end } }, select: { date: true, label: true } }),
  ]);

  // Owners do not take leave, so they would only ever be empty rows.
  const staff = employees.filter(
    (e) => !(isOwnerDesignation(e.designationRef?.name) || isOwnerDesignation(e.designation)),
  );
  const staffIds = new Set(staff.map((e) => e.id));

  type Mark = { kind: "taken" | "planned"; half: boolean; status: string };
  const marks: Record<string, Record<string, Mark>> = {};
  const put = (employeeId: string, iso: string, mark: Mark) => {
    if (!staffIds.has(employeeId)) return;
    marks[employeeId] ??= {};
    // A written day beats a request for the same date — it is the settled truth.
    const existing = marks[employeeId][iso];
    if (existing && existing.kind === "taken") return;
    marks[employeeId][iso] = mark;
  };

  for (const r of requests) {
    const last = r.toDate ?? r.date;
    const cur = new Date(r.date);
    while (cur <= last) {
      if (cur >= start && cur <= end && cur.getUTCDay() !== 0) {
        put(r.employeeId, cur.toISOString().slice(0, 10), {
          kind: "planned",
          half: !!r.halfSession,
          status: r.status,
        });
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  for (const d of leaveDays) {
    put(d.employeeId, d.date.toISOString().slice(0, 10), {
      kind: "taken",
      half: d.status === "HD",
      status: d.status,
    });
  }

  const days: { iso: string; day: number; weekday: string; sunday: boolean; holiday: string | null }[] = [];
  const holidayByIso = new Map(holidays.map((h) => [h.date.toISOString().slice(0, 10), h.label]));
  for (let d = 1; d <= end.getUTCDate(); d++) {
    const dt = new Date(Date.UTC(year, month - 1, d));
    const iso = dt.toISOString().slice(0, 10);
    days.push({
      iso,
      day: d,
      weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()],
      sunday: dt.getUTCDay() === 0,
      holiday: holidayByIso.get(iso) ?? null,
    });
  }

  // Only show people with something in this month — a roster of empty rows
  // hides the handful of rows that matter.
  const rows = staff
    .filter((e) => marks[e.id] && Object.keys(marks[e.id]).length > 0)
    .map((e) => ({ id: e.id, empCode: e.empCode, name: e.name, marks: marks[e.id] }));

  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;

  return (
    <>
      <TopBar
        title="Leave Calendar"
        subtitle={`${start.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })} · ${rows.length} on leave`}
      />
      <div className="p-margin space-y-lg">
        <LeaveCalendarClient month={requested} prevMonth={prev} nextMonth={next} days={days} rows={rows} />
      </div>
    </>
  );
}
