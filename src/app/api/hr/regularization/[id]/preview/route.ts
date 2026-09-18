import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { computeSandwichFlips, getActiveSandwichPolicy } from "@/lib/hr-sandwich";
import { cycleWindowForMonth, cycleMonthForDate } from "@/lib/hr-data";
import { businessDaysBetween } from "@/lib/hr-me";
import { isHalfSession } from "@/lib/hr-regularization";

/**
 * Dry-run the consequences of approving a leave request, so HR can see them
 * BEFORE committing.
 *
 * The sandwich rule treats approved paid leave exactly like an absence: it
 * anchors a bracket, and the week-offs and holidays between two anchors are
 * converted to unpaid absence. Approving Friday and Monday as paid leave
 * therefore also docks the Saturday and Sunday between them.
 *
 * That is the intended policy. What was not intended is that nobody was told:
 * the approval dialog promised only "marks the day as paid leave", the sandwich
 * pass ran after the transaction committed, and the approval route discarded
 * the `flipped` array naming every day it had just converted. HR authorised a
 * three-day pay deduction while reading a one-day confirmation.
 *
 * This runs the same pure resolver the real pass uses, against the days as they
 * WOULD be, and reports the difference. Read-only: nothing is written.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const reg = await prisma.hrAttendanceRegularization.findUnique({
    where: { id: params.id },
    select: {
      employeeId: true,
      date: true,
      toDate: true,
      requestType: true,
      halfSession: true,
    },
  });
  if (!reg) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (reg.requestType !== "leave") return NextResponse.json({ flips: [] });

  const url = new URL(req.url);
  // What HR is about to choose in the dialog; defaults match the API's own.
  const leaveStatus = url.searchParams.get("leaveStatus") === "A" ? "A" : "LV";
  const halfParam = url.searchParams.get("half");
  const half = halfParam === "null" || halfParam === null ? reg.halfSession : halfParam;
  const isHalfDay = isHalfSession(half);
  const targetStatus = isHalfDay ? "HD" : leaveStatus;

  const covered = reg.toDate
    ? await businessDaysBetween(reg.date, reg.toDate)
    : [reg.date];
  const coveredKeys = new Set(covered.map((d) => d.toISOString().slice(0, 10)));

  // Every cycle the range touches — a bracket can straddle the cycle boundary.
  const monthKeys = [...new Set(covered.map((d) => cycleMonthForDate(d)))];
  const windows = monthKeys.map((k) => cycleWindowForMonth(k));
  const windowStart = new Date(Math.min(...windows.map((w) => w.start.getTime())));
  const windowEnd = new Date(Math.max(...windows.map((w) => w.end.getTime())));

  const [days, policy] = await Promise.all([
    prisma.hrAttendanceDay.findMany({
      where: { employeeId: reg.employeeId, date: { gte: windowStart, lte: windowEnd } },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        status: true,
        lateMinutes: true,
        earlyOutMinutes: true,
        halfSession: true,
      },
    }),
    getActiveSandwichPolicy(reg.employeeId),
  ]);

  // Flips that already exist — those are not caused by THIS approval and must
  // not be reported as its consequence.
  const before = computeSandwichFlips(days, policy);
  const beforeIds = new Set(before.map((f) => f.dayId));

  // The same days, as they would be once this request is approved.
  const after = days.map((d) => {
    const key = d.date.toISOString().slice(0, 10);
    if (!coveredKeys.has(key)) return d;
    return { ...d, status: targetStatus, halfSession: isHalfDay ? half : null };
  });
  // A covered day with no attendance row yet still anchors a bracket once the
  // approval creates it, so add a synthetic row for each missing day.
  const present = new Set(days.map((d) => d.date.toISOString().slice(0, 10)));
  for (const d of covered) {
    const key = d.toISOString().slice(0, 10);
    if (present.has(key)) continue;
    after.push({
      id: `pending:${key}`,
      date: d,
      status: targetStatus,
      lateMinutes: null,
      earlyOutMinutes: null,
      halfSession: isHalfDay ? half : null,
    });
  }
  after.sort((a, b) => a.date.getTime() - b.date.getTime());

  const flips = computeSandwichFlips(after, policy)
    .filter((f) => !beforeIds.has(f.dayId))
    .map((f) => ({ date: f.date, from: f.from, to: f.to }));

  return NextResponse.json({
    flips,
    // Working days this approval charges, so the dialog can state the real cost.
    coveredDays: covered.length,
  });
}
