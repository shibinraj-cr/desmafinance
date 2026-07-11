import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { cycleMonthForDate, cycleWindowForMonth } from "@/lib/hr-data";
import { computeMonthlyLeaveLedger, paidLeaveCoveredByDay } from "@/lib/hr-leave-balance";

export const dynamic = "force-dynamic";

export default async function MyAttendancePage({
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
  const days = await prisma.hrAttendanceDay.findMany({
    where: { employeeId: emp.id, date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
  });

  // Counts
  const counts = days.reduce(
    (acc, d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1;
      acc.late += d.lateMinutes ?? 0;
      return acc;
    },
    { late: 0 } as Record<string, number>,
  );
  const lateDays = days.filter((d) => (d.lateMinutes ?? 0) > 10 && (d.status === "P" || d.status === "HD"));

  // Paid-leave coverage for this cycle: the monthly allocation covers the earliest
  // loss-of-pay (absence / half-day / late). Read from the canonical ledger so it
  // matches the Leave tab and payroll, then flag the specific covered days.
  const [ledgerYear, ledgerMonth] = monthKey.split("-").map(Number);
  const { rows: ledgerRows } = await computeMonthlyLeaveLedger(emp.id, ledgerYear, { fill: "full" });
  const cycleRow = ledgerRows.find((r) => r.month === ledgerMonth);
  const paidLeave = cycleRow?.taken ?? 0;
  const unpaidLop = cycleRow?.unpaid ?? 0;
  const paidByDayId = paidLeaveCoveredByDay(days, emp.halfHourConcession, cycleRow?.covered ?? 0);

  const [yStr, mStr] = monthKey.split("-").map(Number);
  const prevMonth = mStr === 1 ? `${yStr - 1}-12` : `${yStr}-${String(mStr - 1).padStart(2, "0")}`;
  const nextMonth = mStr === 12 ? `${yStr + 1}-01` : `${yStr}-${String(mStr + 1).padStart(2, "0")}`;

  return (
    <>
      <TopBar
        title="My Attendance"
        subtitle={`Cycle ${monthKey} · ${days.length} days`}
        action={
          <Link href="/me/regularization" className="px-md py-sm rounded-lg bg-primary text-on-primary text-label-sm font-semibold">
            Request regularization
          </Link>
        }
      />
      <div className="p-margin space-y-lg">
        <Section
          title=""
          action={
            <div className="flex items-center gap-xs">
              <Link href={`/me/attendance?month=${prevMonth}`} className="px-sm py-xs rounded-lg bg-surface-container text-on-surface-variant">←</Link>
              <span className="text-label-sm">{monthKey}</span>
              <Link href={`/me/attendance?month=${nextMonth}`} className="px-sm py-xs rounded-lg bg-surface-container text-on-surface-variant">→</Link>
            </div>
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-base">
            <Stat label="Present" value={counts.P ?? 0} tone="success" />
            <Stat label="Half-day" value={counts.HD ?? 0} tone="warn" />
            <Stat label="Paid leave" value={paidLeave} tone="info" />
            <Stat label="Absent" value={counts.A ?? 0} tone="danger" />
            <Stat label="Week off" value={counts.WO ?? 0} />
            <Stat label="Holiday" value={counts.HL ?? 0} />
          </div>
          <p className="mt-base text-caption text-on-surface-variant">
            {paidLeave > 0 ? (
              <>
                <span className="font-semibold text-emerald-700">Paid leave {paidLeave.toFixed(1)}</span>{" "}
                covered your earliest loss-of-pay this cycle ·{" "}
              </>
            ) : null}
            Unpaid (loss-of-pay): <span className="font-semibold">{unpaidLop.toFixed(1)}</span> day(s) ·
            Late marks (&gt;10 min): {lateDays.length} day(s)
          </p>
        </Section>

        <Section title="Day-by-day">
          {days.length === 0 ? (
            <p className="py-lg text-center text-on-surface-variant">
              No attendance uploaded for this cycle yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-label-sm">
                <thead className="bg-surface-container text-on-surface-variant uppercase tracking-wider text-caption">
                  <tr>
                    <th className="px-sm py-xs text-left">Date</th>
                    <th className="px-sm py-xs text-left">Day</th>
                    <th className="px-sm py-xs text-left">Shift</th>
                    <th className="px-sm py-xs text-left">Status</th>
                    <th className="px-sm py-xs text-left">In</th>
                    <th className="px-sm py-xs text-left">Out</th>
                    <th className="px-sm py-xs text-right">Work</th>
                    <th className="px-sm py-xs text-right">Late</th>
                    <th className="px-sm py-xs text-right">OT</th>
                    <th className="px-sm py-xs text-left">Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.id} className="border-t border-outline-variant">
                      <td className="px-sm py-xs">{d.date.toISOString().slice(0, 10)}</td>
                      <td className="px-sm py-xs">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.date.getUTCDay()]}</td>
                      <td className="px-sm py-xs">{d.shiftCode ?? "—"}</td>
                      <td className="px-sm py-xs">
                        <span className="inline-flex items-center gap-xs">
                          <StatusPill status={d.status} />
                          {paidByDayId.get(d.id) ? (
                            <span
                              className="px-xs py-[1px] rounded text-caption font-semibold bg-emerald-100 text-emerald-800"
                              title={`Paid leave — ${paidByDayId.get(d.id)} day covered by your monthly allocation (paid, not docked)`}
                            >
                              PL
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-sm py-xs font-mono">{d.inTime ?? "—"}</td>
                      <td className="px-sm py-xs font-mono">{d.outTime ?? "—"}</td>
                      <td className="px-sm py-xs text-right tabular-nums">{minutesToHm(d.workMinutes)}</td>
                      <td className="px-sm py-xs text-right tabular-nums">{minutesToHm(d.lateMinutes)}</td>
                      <td className="px-sm py-xs text-right tabular-nums">{minutesToHm(d.otMinutes)}</td>
                      <td className="px-sm py-xs text-on-surface-variant text-caption">{d.remark ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "warn" | "info" | "danger" }) {
  const cls =
    tone === "success"
      ? "text-green-700"
      : tone === "warn"
        ? "text-yellow-700"
        : tone === "info"
          ? "text-blue-700"
          : tone === "danger"
            ? "text-error"
            : "text-on-surface";
  return (
    <div className="bg-surface-container rounded-lg p-md">
      <p className="text-caption text-on-surface-variant uppercase tracking-wider">{label}</p>
      <p className={`text-h2 font-extrabold ${cls}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    P: "bg-green-100 text-green-800",
    HD: "bg-yellow-100 text-yellow-800",
    LV: "bg-blue-100 text-blue-800",
    A: "bg-red-100 text-red-800",
    WO: "bg-gray-100 text-gray-700",
    HL: "bg-purple-100 text-purple-800",
    REG: "bg-cyan-100 text-cyan-800",
    OD: "bg-indigo-100 text-indigo-800",
  };
  return (
    <span className={`px-xs py-[1px] rounded text-caption font-semibold ${map[status] ?? "bg-surface-container text-on-surface-variant"}`}>
      {status}
    </span>
  );
}

function minutesToHm(m: number | null | undefined): string {
  if (!m || m <= 0) return "—";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}
