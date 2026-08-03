import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { cycleMonthForDate, cycleWindowForMonth } from "@/lib/hr-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/summary — everything the mobile Home screen needs in one call:
 * identity + shift, this cycle's attendance tally, leave balance, badge counts
 * (pending approvals, new leads, unread notifications) and a short recent feed.
 * Composes existing HR + CRM data; no new tables.
 */
export async function GET() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const emp = await employeeForUser(userId);

  let attendance: { present: number; workingDays: number } | null = null;
  let leaveBalance:
    | { year: number; balance: number; opening: number; accrued: number; used: number }
    | null = null;
  let shift: { code: string; name: string; startTime: string; endTime: string } | null = null;
  let todayAttendance: { status: string; inTime: string | null; outTime: string | null } | null = null;
  let unreadHr = 0;

  if (emp) {
    const now = new Date();
    const monthKey = cycleMonthForDate(now);
    const { start, end } = cycleWindowForMonth(monthKey);
    const todayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [days, td] = await Promise.all([
      prisma.hrAttendanceDay.findMany({
        where: { employeeId: emp.id, date: { gte: start, lte: end } },
        select: { status: true },
      }),
      prisma.hrAttendanceDay.findFirst({
        where: { employeeId: emp.id, date: todayDate },
        select: { status: true, inTime: true, outTime: true },
      }),
    ]);
    if (td) todayAttendance = { status: td.status, inTime: td.inTime, outTime: td.outTime };
    attendance = {
      present: days.filter((d) => d.status === "P" || d.status === "HD").length,
      workingDays: days.filter((d) => d.status !== "WO" && d.status !== "HL").length,
    };
    const lb = emp.leaveBalances[0];
    if (lb) {
      leaveBalance = {
        year: lb.year,
        balance: Number(lb.balance),
        opening: Number(lb.opening),
        accrued: Number(lb.accrued),
        used: Number(lb.used),
      };
    }
    if (emp.shift) {
      shift = {
        code: emp.shift.code,
        name: emp.shift.name,
        startTime: emp.shift.startTime,
        endTime: emp.shift.endTime,
      };
    }
    unreadHr = await prisma.hrNotificationReceipt.count({
      where: { employeeId: emp.id, readAt: null },
    });
  }

  const [pendingApprovals, newLeads, unreadCrm, recent] = await Promise.all([
    perms?.canApprove
      ? prisma.pendingApproval.count({ where: { status: "pending" } })
      : prisma.pendingApproval.count({ where: { submittedById: userId, status: "pending" } }),
    prisma.crmNotification.count({ where: { userId, readAt: null, kind: "lead_assigned" } }),
    prisma.crmNotification.count({ where: { userId, readAt: null } }),
    prisma.crmNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return NextResponse.json({
    user: {
      name: emp?.name ?? null,
      empCode: emp?.empCode ?? null,
      designation: emp?.designationRef?.name ?? emp?.designation ?? null,
      role: perms?.roleName ?? null,
      isAdmin: perms?.isAdmin ?? false,
    },
    shift,
    attendance,
    todayAttendance,
    leaveBalance,
    pendingApprovals,
    newLeads,
    unread: unreadCrm + unreadHr,
    feed: recent.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      linkUrl: n.linkUrl,
      leadId: n.leadId,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    })),
  });
}
