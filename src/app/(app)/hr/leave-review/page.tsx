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

  const [days, employees, balances] = await Promise.all([
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
      select: { id: true, empCode: true, name: true },
    }),
    prisma.hrLeaveBalance.findMany({
      where: { year: start.getUTCFullYear() },
      select: { employeeId: true, opening: true, accrued: true, used: true, balance: true },
    }),
  ]);

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
      balance: { opening: number; accrued: number; used: number; balance: number } | null;
      rows: {
        id: string;
        date: string;
        status: string;
        rawStatus: string | null;
        remark: string | null;
        in: string | null;
        out: string | null;
        workMinutes: number | null;
        decidedBy: string | null;
        decidedAt: string | null;
        decisionNote: string | null;
      }[];
      counts: { A: number; HD: number; LV: number; undecided: number };
    }
  > = {};

  for (const d of days) {
    const empId = d.employeeId;
    grouped[empId] ??= {
      empId,
      empCode: d.employee.empCode,
      name: d.employee.name,
      balance: balanceByEmp.get(empId) ?? null,
      rows: [],
      counts: { A: 0, HD: 0, LV: 0, undecided: 0 },
    };
    grouped[empId].rows.push({
      id: d.id,
      date: d.date.toISOString().slice(0, 10),
      status: d.status,
      rawStatus: d.rawStatus,
      remark: d.remark,
      in: d.inTime,
      out: d.outTime,
      workMinutes: d.workMinutes,
      decidedBy: d.decidedBy?.username ?? null,
      decidedAt: d.decidedAt ? d.decidedAt.toISOString() : null,
      decisionNote: d.decisionNote,
    });
    if (d.status === "A") grouped[empId].counts.A++;
    else if (d.status === "HD") grouped[empId].counts.HD++;
    else if (d.status === "LV") grouped[empId].counts.LV++;
    if (!d.decidedById) grouped[empId].counts.undecided++;
  }

  // Include employees with zero A/HD/LV so HR can confirm "all clear".
  for (const e of employees) {
    if (!(e.id in grouped)) {
      grouped[e.id] = {
        empId: e.id,
        empCode: e.empCode,
        name: e.name,
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
