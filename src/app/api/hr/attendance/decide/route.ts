import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { applySandwichRule } from "@/lib/hr-sandwich";
import { cycleWindowForMonth, cycleMonthForDate } from "@/lib/hr-data";
import { recomputeLeaveBalance } from "@/lib/hr-leave-balance";
import { leaveStatusBlockedByPunch } from "@/lib/hr-attendance-status";
import { leaveDecisionBlockedReason } from "@/lib/hr-approval-routing";

const Schema = z.object({
  /// Either a single attendance-day id or a batch of ids.
  dayIds: z.array(z.string().min(1)).min(1).max(500),
  /// Decision codes (extended):
  ///   paid        → mark as paid leave (status="LV"; an existing HD stays HD
  ///                 and is flagged halfPaid — half a day of paid leave)
  ///   unpaid      → mark as unpaid leave (status="A"; an existing HD stays HD
  ///                 and is flagged halfPaid=false — half a day of loss-of-pay)
  ///   half_day    → mark as half-day (status="HD")
  ///   on_duty     → on-duty (off-site work, counts as present, status="OD")
  ///   regularized → corrected via regularization workflow (status="REG", treated as P)
  ///   reset       → revert to the original biometric status (rawStatus)
  decision: z.enum(["paid", "unpaid", "half_day", "on_duty", "regularized", "reset"]),
  note: z.string().max(500).nullable().optional(),
  /// When true (default), re-run the sandwich rule for affected
  /// employees over their current cycle after applying decisions.
  applySandwich: z.boolean().default(true),
});

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const { dayIds, decision, note, applySandwich } = parsed.data;

  const days = await prisma.hrAttendanceDay.findMany({
    where: { id: { in: dayIds } },
    select: { id: true, status: true, rawStatus: true, date: true, employeeId: true, inTime: true, outTime: true },
  });
  if (days.length === 0) return NextResponse.json({ error: "no matching days" }, { status: 404 });

  // Approval routing. This route rewrites attendance statuses directly, so
  // without the same guard the request flow carries, an HR Manager could mark
  // their own absence as paid leave here and skip approval entirely — and two HR
  // Managers could do it for each other. Reject the whole batch rather than
  // silently skipping the offending days, so HR sees why. See hr-approval-routing.
  const routingBlock = await leaveDecisionBlockedReason({
    approverUserId: userId,
    perms,
    employeeIds: days.map((d) => d.employeeId),
  });
  if (routingBlock) return NextResponse.json({ error: routingBlock }, { status: 403 });

  // `newHalfPaid` is the pay ruling on a half-day: true = 0.5 charged to the
  // leave balance, false = 0.5 docked, null = no ruling (plain loss-of-pay,
  // what an undecided HD has always been).
  const updates: { id: string; newStatus: string; newHalfPaid: boolean | null }[] = [];
  for (const d of days) {
    let newStatus: string;
    let newHalfPaid: boolean | null = null;
    switch (decision) {
      case "paid":
        // An HD is HALF a day, so paying it means half a day of paid leave —
        // not a full-day LV. Converting it would credit a whole day of leave
        // the employee never took (and the punch guardrail blocks LV on a
        // punched HD outright, leaving those with no way to be paid at all).
        // Mirrors the "unpaid" case below.
        newStatus = d.status === "HD" ? "HD" : "LV";
        if (d.status === "HD") newHalfPaid = true;
        break;
      case "unpaid":
        // HD rows already carry a built-in 0.5-day LOP. "Unpaid" on an HD
        // confirms that half-day deduction as-is — the status stays HD, it's
        // just recorded as a decision (no full-day conversion, so the 0.5 day
        // isn't doubled). Any other status becomes a full-day LOP (status A).
        newStatus = d.status === "HD" ? "HD" : "A";
        if (d.status === "HD") newHalfPaid = false;
        break;
      case "half_day":
        // A status ruling, not a pay one — halfPaid stays null.
        newStatus = "HD";
        break;
      case "on_duty":
        newStatus = "OD";
        break;
      case "regularized":
        newStatus = "REG";
        break;
      case "reset":
      default:
        newStatus = d.rawStatus ?? d.status;
        break;
    }
    updates.push({ id: d.id, newStatus, newHalfPaid });
  }

  // Guardrail: a day with punch-ins is a worked day (P/HD) and can never be
  // reclassified as paid leave (LV) or full absence (A) — that override is what
  // let worked half-days get marked as paid leave. Reject the batch (rather than
  // silently skipping) so HR notices and fixes a wrong punch via Regularization.
  const punchViolations = days.filter((d, i) =>
    leaveStatusBlockedByPunch(updates[i].newStatus, d.inTime, d.outTime),
  );
  if (punchViolations.length > 0) {
    return NextResponse.json(
      {
        error:
          `${punchViolations.length} day(s) have punch-ins, so they're present (P) or half-day (HD) and can't be marked as ${decision === "paid" ? "paid leave" : "absent"}. ` +
          `If a punch is wrong, correct it via Regularization instead.`,
        dayIds: punchViolations.map((d) => d.id),
      },
      { status: 400 },
    );
  }

  const now = new Date();
  await prisma.$transaction([
    ...updates.map((u) =>
      prisma.hrAttendanceDay.update({
        where: { id: u.id },
        data: {
          status: u.newStatus,
          decidedById: decision === "reset" ? null : userId,
          decidedAt: decision === "reset" ? null : now,
          decisionNote: decision === "reset" ? null : note ?? null,
          // A declared half belongs to an approved half-day leave. Any decision
          // taken here supersedes that, and `reset` hands the day back to the
          // biometric feed entirely, so the half must not outlive either.
          halfSession: null,
          halfPaid: u.newHalfPaid,
          // Lock the day so the eTimeOffice sync can't revert this manual
          // override. `reset` hands the day back to the biometric feed, so it
          // unlocks (letting future syncs manage it again).
          locked: decision !== "reset",
        },
      }),
    ),
    prisma.hrAuditLog.create({
      data: {
        actorUserId: userId,
        eventType: `attendance_${decision}`,
        entityType: "HrAttendanceDay",
        metadata: { dayIds, count: dayIds.length, note: note ?? null },
      },
    }),
  ]);

  // Sandwich-rule pass — only for decisions that materially change
  // leave context (paid/unpaid/half_day). Reset/on_duty/regularized
  // don't introduce new leave brackets.
  const sandwichSummary: { employeeId: string; flippedCount: number }[] = [];
  if (
    applySandwich &&
    (decision === "paid" || decision === "unpaid" || decision === "half_day")
  ) {
    const empIds = Array.from(new Set(days.map((d) => d.employeeId)));
    const cycleKey = cycleMonthForDate(days[0].date);
    const { start, end } = cycleWindowForMonth(cycleKey);
    for (const empId of empIds) {
      const r = await applySandwichRule({
        employeeId: empId,
        windowStart: start,
        windowEnd: end,
        actorUserId: userId ?? null,
      });
      if (r.flipped.length > 0) {
        sandwichSummary.push({ employeeId: empId, flippedCount: r.flipped.length });
      }
    }
  }

  // Decisions (and any sandwich-rule flips) change the LV/HD days that drive
  // the leave balance, so recompute the canonical balance for every affected
  // employee/year. Sandwich flips stay inside the cycle window, so the
  // window's calendar year(s) cover them too.
  const affected = new Set<string>(); // `${employeeId}:${year}`
  for (const d of days) affected.add(`${d.employeeId}:${d.date.getUTCFullYear()}`);
  if (sandwichSummary.length > 0) {
    const { start, end } = cycleWindowForMonth(cycleMonthForDate(days[0].date));
    for (const s of sandwichSummary) {
      affected.add(`${s.employeeId}:${start.getUTCFullYear()}`);
      affected.add(`${s.employeeId}:${end.getUTCFullYear()}`);
    }
  }
  for (const key of affected) {
    const [employeeId, yearStr] = key.split(":");
    await recomputeLeaveBalance(employeeId, Number(yearStr));
  }

  return NextResponse.json({
    updated: updates.length,
    decision,
    sandwich: sandwichSummary,
  });
}
