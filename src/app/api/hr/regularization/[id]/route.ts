import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { recomputeLeaveBalance } from "@/lib/hr-leave-balance";
import { applySandwichRule } from "@/lib/hr-sandwich";
import { cycleWindowForMonth, cycleMonthForDate } from "@/lib/hr-data";
import { resolveShiftForDate } from "@/lib/hr-shift";
import { employeeForUser } from "@/lib/hr-me";
import { leaveStatusBlockedByPunch } from "@/lib/hr-attendance-status";

/** Minutes-since-midnight from an "HH:MM" string, or null. */
function hhmmToMin(t: string | null): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : null;
}

/**
 * Gross worked minutes from HH:MM punches (out − in), or null if either is
 * missing or out ≤ in. A regularization rewrites the punches, so the stored
 * workMinutes must be rederived — otherwise it keeps the pre-correction value
 * and the half-day rule / audits read stale minutes (e.g. Sivapriya 20 Apr
 * 2026 kept workMinutes=121 from the old 15:31 punch after correction to 09:00).
 */
function grossWorkMinutes(inTime: string | null, outTime: string | null): number | null {
  if (!inTime || !outTime) return null;
  const toMin = (t: string) => {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    return m ? +m[1] * 60 + +m[2] : null;
  };
  const i = toMin(inTime);
  const o = toMin(outTime);
  if (i == null || o == null || o <= i) return null;
  return o - i;
}

const Schema = z.object({
  decision: z.enum(["approve", "reject", "clarify"]),
  reviewNote: z.string().max(500).nullable().optional(),
  /// On approve: HR may override the proposed times before applying.
  finalIn: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  finalOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  /// On approve: new status to write to the attendance day row.
  finalStatus: z.enum(["P", "HD", "REG"]).default("P"),
  /// On approve of a LEAVE request: paid leave (LV, deducts leave balance) or
  /// unpaid / loss-of-pay (A). HR picks this at approval; defaults to paid.
  leaveStatus: z.enum(["LV", "A"]).default("LV"),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const reg = await prisma.hrAttendanceRegularization.findUnique({
    where: { id: params.id },
    include: { employee: { select: { id: true, empCode: true, name: true } } },
  });
  if (!reg) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (reg.status === "approved" || reg.status === "rejected") {
    return NextResponse.json({ error: "already decided" }, { status: 400 });
  }

  // No self-approval: an approver cannot decide their own request. The HR queue
  // already hides own requests, but enforce it server-side too (so Soumya's
  // requests route only to admin, etc.). Admins with no linked employee are
  // unaffected.
  const approverEmp = userId ? await employeeForUser(userId) : null;
  if (approverEmp && approverEmp.id === reg.employeeId) {
    return NextResponse.json(
      { error: "You can't approve your own request — it must be reviewed by another approver." },
      { status: 403 },
    );
  }

  // A leave request can only be approved onto a no-punch day. If the day has a
  // punch, the employee was present — it's a worked day (P/HD), never paid leave
  // (the same guardrail the decide route enforces).
  if (parsed.data.decision === "approve" && reg.requestType === "leave" && reg.attendanceDayId) {
    const day = await prisma.hrAttendanceDay.findUnique({
      where: { id: reg.attendanceDayId },
      select: { inTime: true, outTime: true },
    });
    if (day && leaveStatusBlockedByPunch(parsed.data.leaveStatus, day.inTime, day.outTime)) {
      return NextResponse.json(
        {
          error: `${reg.date.toISOString().slice(0, 10)} has a punch (${day.inTime ?? "—"}–${day.outTime ?? "—"}) — it's a worked day and can't be marked as leave. Use a punch correction instead.`,
        },
        { status: 400 },
      );
    }
  }

  const now = new Date();
  const newStatus =
    parsed.data.decision === "approve"
      ? "approved"
      : parsed.data.decision === "reject"
        ? "rejected"
        : "clarification";

  // For a punch approval, rederive lateness from the corrected in-time vs the
  // employee's shift start (Saturday = 09:00) so an approved fix clears any AL
  // half-day penalty — i.e. a regularized late day becomes full Present.
  let lateMinutes: number | null = null;
  if (parsed.data.decision === "approve" && reg.requestType !== "leave") {
    const inMin = hhmmToMin(parsed.data.finalIn ?? reg.proposedIn ?? null);
    if (inMin != null) {
      const shift = await resolveShiftForDate(reg.employee.id, reg.date);
      const startMin = reg.date.getUTCDay() === 6 ? 9 * 60 : hhmmToMin(shift?.startTime ?? null);
      if (startMin != null) lateMinutes = Math.max(0, inMin - startMin);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.hrAttendanceRegularization.update({
      where: { id: params.id },
      data: {
        status: newStatus,
        reviewedById: userId ?? null,
        reviewedAt: now,
        reviewNote: parsed.data.reviewNote ?? null,
      },
    });
    if (parsed.data.decision === "approve") {
      // Punch request → corrected punches resolve to the HR-chosen P/HD.
      // Leave request → the day becomes paid leave (LV) or unpaid loss-of-pay
      // (A), per HR's choice; no punch is involved.
      const isLeave = reg.requestType === "leave";
      const inTime = isLeave ? null : parsed.data.finalIn ?? reg.proposedIn ?? null;
      const outTime = isLeave ? null : parsed.data.finalOut ?? reg.proposedOut ?? null;
      const workMinutes = isLeave ? null : grossWorkMinutes(inTime, outTime);
      const targetStatus = isLeave ? parsed.data.leaveStatus : parsed.data.finalStatus;
      const leaveLabel = parsed.data.leaveStatus === "A" ? "Unpaid leave" : "Paid leave";
      const note = isLeave
        ? `${leaveLabel} approved · ${parsed.data.reviewNote ?? ""}`.trim()
        : `Regularized · ${parsed.data.reviewNote ?? ""}`.trim();
      // Resolve the attendance row by its natural key (employeeId, date) — NOT
      // the stored `reg.attendanceDayId`. The eTimeOffice sync delete-and-
      // replaces the cycle window, so a request filed before a sync points at a
      // day id that no longer exists (dangling FK → the old `update where id`
      // threw P2025 and rolled the approval back). Look it up fresh, and re-link
      // `attendanceDayId` if it drifted.
      const existingDay = await tx.hrAttendanceDay.findUnique({
        where: { employeeId_date: { employeeId: reg.employee.id, date: reg.date } },
        select: { id: true },
      });
      if (existingDay) {
        await tx.hrAttendanceDay.update({
          where: { id: existingDay.id },
          data: {
            status: targetStatus,
            inTime,
            outTime,
            // Rederive worked minutes from the corrected punches (OT folded in)
            // so the half-day rule and audits don't read the stale value.
            workMinutes,
            otMinutes: 0,
            ...(lateMinutes != null ? { lateMinutes } : {}),
            decidedById: userId ?? null,
            decidedAt: now,
            decisionNote: note,
            // Lock so the next sync can't revert this approved correction.
            locked: true,
          },
        });
        if (reg.attendanceDayId !== existingDay.id) {
          await tx.hrAttendanceRegularization.update({
            where: { id: params.id },
            data: { attendanceDayId: existingDay.id },
          });
        }
      } else {
        // No attendance row for this date. Use the most recent upload as parent
        // so HrAttendanceUpload aggregations still work; if there are
        // no uploads at all, skip the day-row write and surface a
        // soft warning.
        const upload = await tx.hrAttendanceUpload.findFirst({
          orderBy: { uploadedAt: "desc" },
          select: { id: true },
        });
        if (upload) {
          const created = await tx.hrAttendanceDay.create({
            data: {
              uploadId: upload.id,
              employeeId: reg.employee.id,
              date: reg.date,
              status: targetStatus,
              rawStatus: "REG",
              inTime,
              outTime,
              workMinutes,
              breakMinutes: null,
              otMinutes: 0,
              lateMinutes,
              earlyOutMinutes: null,
              remark: isLeave ? `${leaveLabel} (regularization)` : `Regularized · ${reg.reasonType}`,
              decidedById: userId ?? null,
              decidedAt: now,
              decisionNote: parsed.data.reviewNote ?? null,
              // Lock so the next sync can't revert this approved correction.
              locked: true,
            },
          });
          await tx.hrAttendanceRegularization.update({
            where: { id: params.id },
            data: { attendanceDayId: created.id },
          });
        }
      }
    }
    await tx.hrAuditLog.create({
      data: {
        actorUserId: userId ?? null,
        eventType: `regularization_${parsed.data.decision}`,
        entityType: "HrAttendanceRegularization",
        entityId: params.id,
        metadata: {
          employeeId: reg.employee.id,
          date: reg.date.toISOString().slice(0, 10),
          reviewNote: parsed.data.reviewNote ?? null,
        },
      },
    });
  });

  // An approved punch correction can change the day's status (e.g. a
  // missing-punch fix turns an LV/HD day back into P), which changes the LV/HD
  // days that drive the canonical leave balance. Mirror the decide route and
  // recompute it — otherwise the balance (and the salary run that reads it)
  // stays frozen at the pre-correction figures. Sivapriya, Apr 2026: her 11 Apr
  // LV was regularized to P, but `used` stayed at 4 and balance at 0 because
  // this path never refreshed it.
  if (parsed.data.decision === "approve") {
    // The approved correction changed the day's status, which can create or
    // dissolve a sandwich bracket — re-reconcile the employee's cycle. This
    // both flips newly-sandwiched WO/HL and reverts prior flips that no longer
    // apply (e.g. a punch fix turning an absence anchor into Present).
    const { start, end } = cycleWindowForMonth(cycleMonthForDate(reg.date));
    await applySandwichRule({ employeeId: reg.employee.id, windowStart: start, windowEnd: end, actorUserId: userId ?? null });
    await recomputeLeaveBalance(reg.employee.id, reg.date.getUTCFullYear());
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
