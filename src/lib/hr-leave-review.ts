import { prisma } from "./prisma";
import {
  cycleWindowForMonth,
  cycleMonthForDate,
  computeLateTags,
  LCE_GRACE_DAYS,
  LCE_GRACE_MINUTES,
} from "./hr-data";

/**
 * Data for the "Leave decisions" tab of the Regularization page (formerly the
 * standalone Leave Review page). Lists NO-PUNCH absence days (A / LV with no
 * punch) that HR must classify paid vs unpaid. Punched days are worked days
 * (P / HD) decided by the punch guardrail — they never appear here. Also
 * surfaces each employee's late-coming (LCE/AL) usage and leave balance.
 */
export type LeaveReviewRow = {
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
};

export type LeaveReviewGroup = {
  empId: string;
  empCode: string;
  name: string;
  lateEligible: boolean;
  late: { lceUsed: number; alCount: number };
  lateGraceMinutes: number;
  lateGraceDays: number;
  balance: { opening: number; accrued: number; used: number; balance: number } | null;
  rows: LeaveReviewRow[];
  counts: { A: number; HD: number; LV: number; undecided: number };
};

export type LeaveReviewData = {
  requested: string;
  prevMonth: string;
  nextMonth: string;
  cycleLabel: string;
  groups: LeaveReviewGroup[];
  totalUndecided: number;
};

export async function loadLeaveReview(monthArg?: string): Promise<LeaveReviewData> {
  const today = new Date();
  const requested =
    monthArg && /^\d{4}-\d{2}$/.test(monthArg) ? monthArg : cycleMonthForDate(today);
  const { start, end } = cycleWindowForMonth(requested);

  const [days, employees, balances, lateDays] = await Promise.all([
    prisma.hrAttendanceDay.findMany({
      where: {
        date: { gte: start, lte: end },
        // No-punch absence days only — the rows HR must classify paid/unpaid.
        // Punched days (P/HD) are worked days and are off-limits to leave
        // decisions (enforced by the decide guardrail), so they're excluded.
        status: { in: ["A", "LV"] },
        inTime: null,
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
      select: { id: true, empCode: true, name: true, halfHourConcession: true },
    }),
    prisma.hrLeaveBalance.findMany({
      where: { year: start.getUTCFullYear() },
      select: { employeeId: true, opening: true, accrued: true, used: true, balance: true },
    }),
    prisma.hrAttendanceDay.findMany({
      where: { date: { gte: start, lte: end }, status: { in: ["P", "HD"] }, lateMinutes: { gt: 0 } },
      select: { id: true, employeeId: true, date: true, lateMinutes: true, status: true },
      orderBy: { date: "asc" },
    }),
  ]);

  const empEligibleById = new Map(employees.map((e) => [e.id, e.halfHourConcession]));
  const lateByEmpRaw: Record<string, typeof lateDays> = {};
  for (const ld of lateDays) {
    lateByEmpRaw[ld.employeeId] ??= [];
    lateByEmpRaw[ld.employeeId].push(ld);
  }
  const lateByEmp: Record<string, { lceUsed: number; alCount: number }> = {};
  for (const empId of Object.keys(lateByEmpRaw)) {
    lateByEmp[empId] = computeLateTags(lateByEmpRaw[empId], empEligibleById.get(empId) ?? false);
  }

  const balanceByEmp = new Map(
    balances.map((b) => [
      b.employeeId,
      { opening: Number(b.opening), accrued: Number(b.accrued), used: Number(b.used), balance: Number(b.balance) },
    ]),
  );

  const empMetaById = new Map(employees.map((e) => [e.id, e]));
  const grouped: Record<string, LeaveReviewGroup> = {};
  const blank = (empId: string, empCode: string, name: string, lateEligible: boolean): LeaveReviewGroup => ({
    empId,
    empCode,
    name,
    lateEligible,
    late: lateByEmp[empId] ?? { lceUsed: 0, alCount: 0 },
    lateGraceMinutes: LCE_GRACE_MINUTES,
    lateGraceDays: LCE_GRACE_DAYS,
    balance: balanceByEmp.get(empId) ?? null,
    rows: [],
    counts: { A: 0, HD: 0, LV: 0, undecided: 0 },
  });

  for (const d of days) {
    const empId = d.employeeId;
    grouped[empId] ??= blank(empId, d.employee.empCode, d.employee.name, empMetaById.get(empId)?.halfHourConcession ?? false);
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
    else if (d.status === "LV") grouped[empId].counts.LV++;
    if (!d.decidedById) grouped[empId].counts.undecided++;
  }
  for (const e of employees) {
    if (!(e.id in grouped)) grouped[e.id] = blank(e.id, e.empCode, e.name, e.halfHourConcession);
  }

  const groups = Object.values(grouped).sort((a, b) => a.empCode.localeCompare(b.empCode));
  const [yStr, mStr] = requested.split("-").map(Number);
  const prevMonth = mStr === 1 ? `${yStr - 1}-12` : `${yStr}-${String(mStr - 1).padStart(2, "0")}`;
  const nextMonth = mStr === 12 ? `${yStr + 1}-01` : `${yStr}-${String(mStr + 1).padStart(2, "0")}`;
  const cycleLabel = `${start.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })} → ${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`;
  const totalUndecided = groups.reduce((s, g) => s + g.counts.undecided, 0);

  return { requested, prevMonth, nextMonth, cycleLabel, groups, totalUndecided };
}
