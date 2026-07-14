import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { cycleMonthForDate, cycleWindowForMonth } from "@/lib/hr-data";
import {
  attendanceScoreTrend,
  latestCompleteCycleMonth,
  type AttendanceScoreTrend,
} from "@/lib/hr-attendance-score-data";
import { AttendanceScoreTrendCard } from "@/components/AttendanceScoreTrendCard";

export const dynamic = "force-dynamic";

export default async function MeHomePage() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) redirect("/login");
  const employee = await prisma.employee.findUnique({
    where: { userId },
    include: { shift: true, leaveBalances: { orderBy: { year: "desc" }, take: 1 } },
  });

  // Per-employee feeds for the home page: the notification receipts (same source
  // as Resources → Notifications) and the employee's attendance-regularization
  // requests, plus a count of attendance days in the current cycle that still
  // need a punch/leave regularization.
  let notifs: {
    id: string;
    title: string;
    body: string;
    linkUrl: string | null;
    createdAt: string;
    read: boolean;
    requiresAck: boolean;
    acked: boolean;
  }[] = [];
  let regRequests: {
    id: string;
    date: string;
    requestType: string;
    status: string;
    reason: string;
    reviewNote: string | null;
  }[] = [];
  let exceptionsCount = 0;
  let scoreTrend: AttendanceScoreTrend | null = null;

  if (employee) {
    const monthKey = cycleMonthForDate(new Date());
    const { start, end } = cycleWindowForMonth(monthKey);
    const [receipts, reqs, cycleDays, liveReq, trend] = await Promise.all([
      prisma.hrNotificationReceipt.findMany({
        where: { employeeId: employee.id },
        orderBy: { notification: { createdAt: "desc" } },
        take: 6,
        include: { notification: true },
      }),
      prisma.hrAttendanceRegularization.findMany({
        where: { employeeId: employee.id },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      prisma.hrAttendanceDay.findMany({
        where: { employeeId: employee.id, date: { gte: start, lte: end } },
        select: { date: true, status: true, inTime: true, outTime: true },
      }),
      prisma.hrAttendanceRegularization.findMany({
        where: {
          employeeId: employee.id,
          date: { gte: start, lte: end },
          status: { in: ["pending", "clarification", "approved"] },
        },
        select: { date: true },
      }),
      attendanceScoreTrend(employee.id, latestCompleteCycleMonth(new Date())),
    ]);
    scoreTrend = trend;

    notifs = receipts.map((r) => ({
      id: r.notificationId,
      title: r.notification.title,
      body: r.notification.body,
      linkUrl: r.notification.linkUrl,
      createdAt: r.notification.createdAt.toISOString(),
      read: !!r.readAt,
      requiresAck: r.notification.requiresAck,
      acked: !!r.acknowledgedAt,
    }));

    regRequests = reqs.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      requestType: r.requestType,
      status: r.status,
      reason: r.reason,
      reviewNote: r.reviewNote,
    }));

    const requested = new Set(liveReq.map((r) => r.date.toISOString().slice(0, 10)));
    exceptionsCount = cycleDays.filter((d) => {
      if (d.status === "WO" || d.status === "HL") return false;
      if (requested.has(d.date.toISOString().slice(0, 10))) return false;
      const punches = (d.inTime ? 1 : 0) + (d.outTime ? 1 : 0);
      return d.status === "A" || punches === 1; // absent, or exactly one punch
    }).length;
  }

  const unreadCount = notifs.filter((n) => !n.read).length;
  const openReg = regRequests.filter((r) => r.status === "pending" || r.status === "clarification").length;
  const shift = employee?.shift;

  return (
    <>
      <TopBar
        title={`Hello, ${employee?.name ?? perms.roleName}`}
        subtitle={employee ? `${employee.empCode} · ${employee.designation ?? ""}` : ""}
      />
      <div className="p-margin space-y-lg">
        {!employee && (
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">
              Your login isn&apos;t linked to an employee record yet. Ask HR to link your account from
              the Employees page.
            </p>
          </Section>
        )}
        {employee && (
          <>
            <Section title="Quick view">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-base">
                <Stat
                  label={shift ? `Shift ${shift.code}` : "Shift"}
                  value={shift ? `${shift.startTime} – ${shift.endTime}` : "—"}
                  sub={shift?.name}
                />
                <Stat
                  label="Leave balance"
                  value={
                    employee.leaveBalances[0]
                      ? Number(employee.leaveBalances[0].balance).toFixed(1)
                      : "0.0"
                  }
                />
                <Stat label="Bank" value={employee.bankName ?? "—"} />
              </div>
            </Section>

            {scoreTrend && <AttendanceScoreTrendCard trend={scoreTrend} />}

            <Section
              title="Notifications"
              action={
                <Link href="/me/notifications" className="text-label-sm text-primary font-semibold">
                  View all{unreadCount > 0 ? ` (${unreadCount} unread)` : ""} →
                </Link>
              }
            >
              {notifs.length === 0 ? (
                <p className="py-base text-center text-on-surface-variant text-label-sm">
                  No notifications yet.
                </p>
              ) : (
                <ul className="divide-y divide-outline-variant">
                  {notifs.map((n) => {
                    const inner = (
                      <div className="flex items-start gap-sm py-sm">
                        <span
                          className={
                            "mt-[6px] h-2 w-2 rounded-full shrink-0 " +
                            (n.read ? "bg-transparent border border-outline-variant" : "bg-primary")
                          }
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-xs flex-wrap">
                            <span className={"text-label-sm " + (n.read ? "font-medium" : "font-bold")}>
                              {n.title}
                            </span>
                            {n.requiresAck && !n.acked && (
                              <span className="px-xs py-[1px] rounded text-caption font-semibold bg-amber-100 text-amber-800">
                                Action needed
                              </span>
                            )}
                          </div>
                          {n.body && (
                            <p className="text-caption text-on-surface-variant line-clamp-2">{n.body}</p>
                          )}
                        </div>
                        <span className="text-caption text-on-surface-variant whitespace-nowrap">
                          {fmtDate(n.createdAt)}
                        </span>
                      </div>
                    );
                    return (
                      <li key={n.id}>
                        {n.linkUrl ? (
                          <Link href={n.linkUrl} className="block hover:bg-surface-container rounded-lg px-xs">
                            {inner}
                          </Link>
                        ) : (
                          <div className="px-xs">{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section
              title="Attendance regularization"
              action={
                <Link href="/me/regularization" className="text-label-sm text-primary font-semibold">
                  Open →
                </Link>
              }
            >
              {exceptionsCount > 0 && (
                <Link
                  href="/me/regularization"
                  className="mb-sm flex items-center gap-sm rounded-lg bg-amber-50 border border-amber-200 px-md py-sm text-amber-900"
                >
                  <span className="material-symbols-outlined text-[20px]">edit_calendar</span>
                  <span className="text-label-sm font-semibold">
                    {exceptionsCount} attendance day{exceptionsCount > 1 ? "s" : ""} this cycle need
                    {exceptionsCount > 1 ? "" : "s"} a punch / leave regularization →
                  </span>
                </Link>
              )}
              {regRequests.length === 0 ? (
                exceptionsCount === 0 && (
                  <p className="py-base text-center text-on-surface-variant text-label-sm">
                    No regularization requests. Absences and missing punches will show here.
                  </p>
                )
              ) : (
                <ul className="divide-y divide-outline-variant">
                  {regRequests.map((r) => (
                    <li key={r.id} className="flex items-center gap-sm py-sm">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-xs flex-wrap">
                          <span className="text-label-sm font-semibold tabular-nums">{r.date}</span>
                          <span className="px-xs py-[1px] rounded text-caption font-semibold bg-surface-container text-on-surface-variant">
                            {r.requestType === "leave" ? "Leave" : "Punch"}
                          </span>
                          <RegStatusPill status={r.status} />
                        </div>
                        <p className="text-caption text-on-surface-variant line-clamp-1">
                          {r.reviewNote ? `HR: ${r.reviewNote}` : r.reason}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {openReg > 0 && (
                <p className="mt-sm text-caption text-on-surface-variant">
                  {openReg} request{openReg > 1 ? "s" : ""} awaiting HR review or your response.
                </p>
              )}
            </Section>
          </>
        )}
      </div>
    </>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function RegStatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    clarification: "bg-blue-100 text-blue-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };
  const label: Record<string, string> = {
    pending: "Pending",
    clarification: "Needs your reply",
    approved: "Approved",
    rejected: "Rejected",
  };
  return (
    <span
      className={
        "px-xs py-[1px] rounded text-caption font-semibold " +
        (map[status] ?? "bg-surface-container text-on-surface-variant")
      }
    >
      {label[status] ?? status}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="bg-surface-container rounded-lg p-md">
      <p className="text-caption text-on-surface-variant uppercase tracking-wider">{label}</p>
      <p className="text-h2 font-extrabold">{value}</p>
      {sub && <p className="text-caption text-on-surface-variant mt-xs">{sub}</p>}
    </div>
  );
}
