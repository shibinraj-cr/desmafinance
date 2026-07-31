import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { REGULARIZATION_REASONS, REGULARIZATION_WINDOW_WORKING_DAYS } from "@/lib/hr-regularization";
import { cycleWindowForMonth, cycleMonthForDate, computeLateTags } from "@/lib/hr-data";
import { RegularizationRequestClient } from "./client";

export const dynamic = "force-dynamic";

export default async function MyRegularizationPage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");
  const emp = await employeeForUser(userId);
  if (!emp) {
    return (
      <>
        <TopBar title="My Attendance" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              Your login isn&apos;t linked to an employee record. Ask HR to link your account.
            </div>
          </Section>
        </div>
      </>
    );
  }

  const today = new Date();
  const monthKey =
    searchParams?.month && /^\d{4}-\d{2}$/.test(searchParams.month)
      ? searchParams.month
      : cycleMonthForDate(today);
  const { start, end } = cycleWindowForMonth(monthKey);

  const [days, cycleRequests, allRequests] = await Promise.all([
    prisma.hrAttendanceDay.findMany({
      where: { employeeId: emp.id, date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
      select: { id: true, date: true, status: true, inTime: true, outTime: true, lateMinutes: true },
    }),
    // Days already covered by a live request (so they drop out of the to-do list).
    prisma.hrAttendanceRegularization.findMany({
      where: {
        employeeId: emp.id,
        date: { gte: start, lte: end },
        status: { in: ["pending", "clarification", "approved"] },
      },
      select: { date: true },
    }),
    prisma.hrAttendanceRegularization.findMany({
      where: { employeeId: emp.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // Late tags for the whole cycle (LCE quota is stateful) — same eligibility
  // source the HR grid uses. A P day tagged AL is a penalised late-coming that
  // payroll docks as a half-day, so it's worth surfacing for an explanation;
  // LCE days (late but within the concession) are not penalised → not surfaced.
  const { tags } = computeLateTags(
    days.map((d) => ({ id: d.id, date: d.date, lateMinutes: d.lateMinutes, status: d.status })),
    emp.halfHourConcession,
  );

  const requested = new Set(cycleRequests.map((r) => r.date.toISOString().slice(0, 10)));
  const exceptions = days
    .map((d) => {
      const punches = (d.inTime ? 1 : 0) + (d.outTime ? 1 : 0);
      // Precedence: absent → incomplete (missing punch) → half-day → late.
      // half-day requires both punches so a one-punch HD stays "incomplete".
      const kind =
        d.status === "A"
          ? ("absent" as const)
          : punches === 1
            ? ("incomplete" as const)
            : d.status === "HD"
              ? ("halfday" as const)
              : d.status === "P" && tags.get(d.id) === "AL"
                ? ("late" as const)
                : null;
      return { d, kind };
    })
    .filter((x): x is { d: (typeof days)[number]; kind: "absent" | "incomplete" | "halfday" | "late" } => {
      if (!x.kind) return false;
      if (x.d.status === "WO" || x.d.status === "HL") return false;
      if (requested.has(x.d.date.toISOString().slice(0, 10))) return false;
      return true;
    })
    .map(({ d, kind }) => ({
      date: d.date.toISOString().slice(0, 10),
      weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.date.getUTCDay()],
      status: d.status,
      in: d.inTime,
      out: d.outTime,
      lateMinutes: d.lateMinutes,
      kind,
    }));

  const reasonLabel = Object.fromEntries(REGULARIZATION_REASONS.map((r) => [r.code, r.label]));
  const [yStr, mStr] = monthKey.split("-").map(Number);
  const prevMonth = mStr === 1 ? `${yStr - 1}-12` : `${yStr}-${String(mStr - 1).padStart(2, "0")}`;
  const nextMonth = mStr === 12 ? `${yStr + 1}-01` : `${yStr}-${String(mStr + 1).padStart(2, "0")}`;
  const cycleLabel = `${start.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })} → ${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`;

  return (
    <>
      <TopBar
        title="My Attendance"
        subtitle={`Raise punch / leave / explanation requests within ${REGULARIZATION_WINDOW_WORKING_DAYS} working days · ${exceptions.length} to review`}
      />
      <div className="p-margin space-y-lg">
        <RegularizationRequestClient
          reasons={REGULARIZATION_REASONS as unknown as { code: string; label: string }[]}
          monthKey={monthKey}
          prevMonth={prevMonth}
          nextMonth={nextMonth}
          cycleLabel={cycleLabel}
          exceptions={exceptions}
          requests={allRequests.map((r) => ({
            id: r.id,
            date: r.date.toISOString().slice(0, 10),
            requestType: r.requestType,
            reasonType: r.reasonType,
            reasonLabel:
              r.requestType === "leave"
                ? "Leave request"
                : r.requestType === "note"
                  ? "Explanation on record"
                  : reasonLabel[r.reasonType] ?? r.reasonType,
            reason: r.reason,
            proposedIn: r.proposedIn,
            proposedOut: r.proposedOut,
            status: r.status,
            reviewNote: r.reviewNote,
            createdAt: r.createdAt.toISOString(),
          }))}
        />
      </div>
    </>
  );
}
