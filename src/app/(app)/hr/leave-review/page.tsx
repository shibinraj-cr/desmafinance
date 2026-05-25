import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import {
  cycleWindowForMonth,
  cycleMonthForDate,
} from "@/lib/hr-data";
import { LeaveReviewClient } from "./client";

export const dynamic = "force-dynamic";

export default async function LeaveReviewPage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Leave Review" />
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

  const [days, employees, balances, lateDays] = await Promise.all([
    prisma.hrAttendanceDay.findMany({
      where: {
        date: { gte: start, lte: end },
        // Only show A, HD, LV — the rows HR needs to classify (or has
        // already classified). Skip P / WO / HL.
        status: { in: ["A", "HD", "LV"] },
      },
      orderBy: [{ employeeId: "asc" }, { date: "asc" }],
      include: {
        employee: { select: { empCode: true, name: true } },
        decidedBy: { select: { username: true } },
      },
    }),
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { empCode: "asc" },
      select: {
        id: true,
        empCode: true,
        name: true,
        halfHourConcession: true,
      },
    }),
    prisma.hrLeaveBalance.findMany({
      where: { year: start.getUTCFullYear() },
      select: { employeeId: true, opening: true, accrued: true, used: true, balance: true },
    }),
    // Pull P + HD days with late > 0 so we can compute the late-coming
    // concession usage per employee for this cycle.
    prisma.hrAttendanceDay.findMany({
      where: {
        date: { gte: start, lte: end },
        status: { in: ["P", "HD"] },
        lateMinutes: { gt: 0 },
      },
      select: { employeeId: true, date: true, lateMinutes: true },
      orderBy: { date: "asc" },
    }),
  ]);

  // Late-coming concession: 30 min × 3 days per cycle.
  const LATE_GRACE_MINUTES = 30;
  const LATE_GRACE_DAYS = 3;
  const lateByEmp: Record<string, { withinGrace: number; overGrace: number; daysCount: number }> = {};
  for (const ld of lateDays) {
    const lm = ld.lateMinutes ?? 0;
    lateByEmp[ld.employeeId] ??= { withinGrace: 0, overGrace: 0, daysCount: 0 };
    lateByEmp[ld.employeeId].daysCount++;
    if (lm <= LATE_GRACE_MINUTES) lateByEmp[ld.employeeId].withinGrace++;
    else lateByEmp[ld.employeeId].overGrace++;
  }

  const balanceByEmp = new Map(
    balances.map((b) => [
      b.employeeId,
      {
        opening: Number(b.opening),
        accrued: Number(b.accrued),
        used: Number(b.used),
        balance: Number(b.balance),
      },
    ]),
  );

  // Group days by employee for the UI.
  const grouped: Record<
    string,
    {
      empId: string;
      empCode: string;
      name: string;
      lateEligible: boolean;
      late: { withinGrace: number; overGrace: number; daysCount: number };
      lateGraceMinutes: number;
      lateGraceDays: number;
      balance: { opening: number; accrued: number; used: number; balance: number } | null;
      rows: {
        id: string;
        date: string;
        weekday: string;
        shiftCode: string | null;
        status: string;
        rawStatus: string | null;
        remark: string | null;
        in: string | null;
        out: string | null;
        workMinutes: number | null;
        lateMinutes: number | null;
        earlyOutMinutes: number | null;
        decidedBy: string | null;
        decidedAt: string | null;
        decisionNote: string | null;
      }[];
      counts: { A: number; HD: number; LV: number; undecided: number };
    }
  > = {};

  // Build empId → metadata lookup for late-coming eligibility.
  const empMetaById = new Map(employees.map((e) => [e.id, e]));

  for (const d of days) {
    const empId = d.employeeId;
    const empMeta = empMetaById.get(empId);
    grouped[empId] ??= {
      empId,
      empCode: d.employee.empCode,
      name: d.employee.name,
      lateEligible: empMeta?.halfHourConcession ?? false,
      late: lateByEmp[empId] ?? { withinGrace: 0, overGrace: 0, daysCount: 0 },
      lateGraceMinutes: LATE_GRACE_MINUTES,
      lateGraceDays: LATE_GRACE_DAYS,
      balance: balanceByEmp.get(empId) ?? null,
      rows: [],
      counts: { A: 0, HD: 0, LV: 0, undecided: 0 },
    };
    grouped[empId].rows.push({
      id: d.id,
      date: d.date.toISOString().slice(0, 10),
      weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.date.getUTCDay()],
      shiftCode: d.shiftCode,
      status: d.status,
      rawStatus: d.rawStatus,
      remark: d.remark,
      in: d.inTime,
      out: d.outTime,
      workMinutes: d.workMinutes,
      lateMinutes: d.lateMinutes,
      earlyOutMinutes: d.earlyOutMinutes,
      decidedBy: d.decidedBy?.username ?? null,
      decidedAt: d.decidedAt ? d.decidedAt.toISOString() : null,
      decisionNote: d.decisionNote,
    });
    if (d.status === "A") grouped[empId].counts.A++;
    else if (d.status === "HD") grouped[empId].counts.HD++;
    else if (d.status === "LV") grouped[empId].counts.LV++;
    if (!d.decidedById) grouped[empId].counts.undecided++;
  }

  // Include employees with zero A/HD/LV so HR can confirm "all clear" and
  // can still see their late-coming concession usage.
  for (const e of employees) {
    if (!(e.id in grouped)) {
      grouped[e.id] = {
        empId: e.id,
        empCode: e.empCode,
        name: e.name,
        lateEligible: e.halfHourConcession,
        late: lateByEmp[e.id] ?? { withinGrace: 0, overGrace: 0, daysCount: 0 },
        lateGraceMinutes: LATE_GRACE_MINUTES,
        lateGraceDays: LATE_GRACE_DAYS,
        balance: balanceByEmp.get(e.id) ?? null,
        rows: [],
        counts: { A: 0, HD: 0, LV: 0, undecided: 0 },
      };
    }
  }

  const orderedGroups = Object.values(grouped).sort((a, b) => a.empCode.localeCompare(b.empCode));

  // Compute prev/next cycle for the nav arrows.
  const [yStr, mStr] = requested.split("-").map(Number);
  const prevMonth = mStr === 1 ? `${yStr - 1}-12` : `${yStr}-${String(mStr - 1).padStart(2, "0")}`;
  const nextMonth = mStr === 12 ? `${yStr + 1}-01` : `${yStr}-${String(mStr + 1).padStart(2, "0")}`;
  const cycleLabel = `${start.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })} → ${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`;

  const totalUndecided = orderedGroups.reduce((s, g) => s + g.counts.undecided, 0);

  return (
    <>
      <TopBar
        title="Leave Review"
        subtitle={`Cycle ${requested} · ${cycleLabel} · ${totalUndecided} undecided`}
      />
      <div className="p-margin">
        <LeaveReviewClient
          monthKey={requested}
          prevMonth={prevMonth}
          nextMonth={nextMonth}
          cycleLabel={cycleLabel}
          groups={orderedGroups}
          canDecide={canApproveHr(perms)}
        />
      </div>
    </>
  );
}
