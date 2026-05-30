import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { applySandwichRule } from "@/lib/hr-sandwich";
import { cycleWindowForMonth, cycleMonthForDate } from "@/lib/hr-data";
import { recomputeLeaveBalance } from "@/lib/hr-leave-balance";

const Schema = z.object({
  /// Either a single attendance-day id or a batch of ids.
  dayIds: z.array(z.string().min(1)).min(1).max(500),
  /// Decision codes (extended):
  ///   paid        → mark as paid leave (status="LV")
  ///   unpaid      → mark as unpaid leave (status="A")
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
    select: { id: true, status: true, rawStatus: true, date: true, employeeId: true },
  });
  if (days.length === 0) return NextResponse.json({ error: "no matching days" }, { status: 404 });

  const updates: { id: string; newStatus: string }[] = [];
  const blocked: string[] = [];
  for (const d of days) {
    let newStatus: string;
    switch (decision) {
      case "paid":
        newStatus = "LV";
        break;
      case "unpaid":
        if (d.status === "HD") {
          blocked.push(d.id);
          continue;
        }
        newStatus = "A";
        break;
      case "half_day":
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
    updates.push({ id: d.id, newStatus });
  }

  if (blocked.length > 0 && updates.length === 0) {
    return NextResponse.json(
      {
        error:
          "Unpaid is not applicable to Half-day rows — HD already has 0.5 day deduction built in. Use Reset to revert, or Paid to convert to a full Paid Leave day.",
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
    blocked: blocked.length,
    sandwich: sandwichSummary,
  });
}
