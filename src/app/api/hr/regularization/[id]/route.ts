import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { recomputeLeaveBalance } from "@/lib/hr-leave-balance";
import { applySandwichRule } from "@/lib/hr-sandwich";
import { cycleWindowForMonth, cycleMonthForDate } from "@/lib/hr-data";
import { resolveShiftForDate } from "@/lib/hr-shift";
import { leaveStatusBlockedByPunch } from "@/lib/hr-attendance-status";
import { leaveDecisionBlockedReason } from "@/lib/hr-approval-routing";
import { halfSessionLabel, isHalfSession } from "@/lib/hr-regularization";
import { notifyRequestDecided } from "@/lib/hr-request-notify";

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
  /// On approve of a LEAVE request: paid (deducts the leave balance) or unpaid
  /// / loss-of-pay. HR picks this at approval; defaults to paid. A full-day
  /// leave writes it as the day's status (LV / A); a half-day leave writes it as
  /// `halfPaid` on an HD day, charging 0.5 to the balance or docking 0.5 of pay.
  leaveStatus: z.enum(["LV", "A"]).default("LV"),
  /// On approve of a LEAVE request: which half was actually taken — "AM"
  /// (first half) / "PM" (second half), or null to approve it as a full day.
  /// Omit to honour what the employee asked for; send it to override them.
  finalHalfSession: z.enum(["AM", "PM"]).nullable().optional(),
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

  // Approval routing: no self-approval, and an HR approver's own request is
  // decidable only by the designated approver. The HR queue already hides both,
  // but the queue is a convenience — this is the guard. See hr-approval-routing.
  const blocked = await leaveDecisionBlockedReason({
    approverUserId: userId,
    perms,
    employeeIds: [reg.employeeId],
  });
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

  // Which half the employee asked for, if any. HR may correct it at approval
  // (`finalHalfSession`) — e.g. the punches show the afternoon was the missing
  // half. A request with no half is a full-day leave, as before.
  const requestedHalf = isHalfSession(reg.halfSession) ? reg.halfSession : null;
  const half =
    parsed.data.finalHalfSession !== undefined
      ? parsed.data.finalHalfSession
      : requestedHalf;
  const isHalfDayLeave = reg.requestType === "leave" && half !== null;
  const isPaidLeave = parsed.data.leaveStatus === "LV";
  // A half-day leave always resolves to the HD status — half a day, not a whole
  // one. Paid vs unpaid rides on `halfPaid` instead of the status, because there
  // is no half-day equivalent of the LV / A status pair: paid charges 0.5 to the
  // leave balance (as LV does at 1.0), unpaid docks 0.5 of pay (as A does at 1.0).
  const leaveTargetStatus = isHalfDayLeave ? "HD" : parsed.data.leaveStatus;

  // A full-day leave can only be approved onto a no-punch day. If the day has a
  // punch, the employee was present — it's a worked day (P/HD), never paid leave
  // (the same guardrail the decide route enforces). A HALF-day (HD) is the one
  // leave shape that survives this check, which is exactly why a punched day can
  // be claimed as a half-day and not as a whole one.
  if (parsed.data.decision === "approve" && reg.requestType === "leave") {
    const day = await prisma.hrAttendanceDay.findUnique({
      where: { employeeId_date: { employeeId: reg.employeeId, date: reg.date } },
      select: { inTime: true, outTime: true },
    });
    if (day && leaveStatusBlockedByPunch(leaveTargetStatus, day.inTime, day.outTime)) {
      return NextResponse.json(
        {
          error: `${reg.date.toISOString().slice(0, 10)} has a punch (${day.inTime ?? "—"}–${day.outTime ?? "—"}) — it's a worked day and can't be marked as full-day leave. Approve it as a half-day, or use a punch correction instead.`,
        },
        { status: 400 },
      );
    }
  }

  // A 'note' is an on-record explanation for a half-day / late-coming day. Its
  // approval acknowledges the reason but must NOT touch the attendance day — the
  // day stays as-is (HD / late penalty retained). Only the request row is updated.
  const isNote = reg.requestType === "note";

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
  if (parsed.data.decision === "approve" && reg.requestType === "punch") {
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
    if (parsed.data.decision === "approve" && !isNote) {
      // Punch request → corrected punches resolve to the HR-chosen P/HD.
      // Full-day leave → paid leave (LV) or unpaid loss-of-pay (A), per HR's
      // choice; no punch is involved.
      // Half-day leave → HD, keeping whatever punches the day already has.
      const isLeave = reg.requestType === "leave";
      // Resolve the attendance row by its natural key (employeeId, date) — NOT
      // the stored `reg.attendanceDayId`. The eTimeOffice sync delete-and-
      // replaces the cycle window, so a request filed before a sync points at a
      // day id that no longer exists (dangling FK → the old `update where id`
      // threw P2025 and rolled the approval back). Look it up fresh, and re-link
      // `attendanceDayId` if it drifted.
      const existingDay = await tx.hrAttendanceDay.findUnique({
        where: { employeeId_date: { employeeId: reg.employee.id, date: reg.date } },
        select: { id: true, inTime: true, outTime: true, workMinutes: true },
      });
      // A half-day leave keeps the punches it already has — the employee worked
      // the other half, so blanking the times would erase a real worked stretch
      // (and with it the late/early-out signals the sandwich rule reads). Only a
      // FULL-day leave clears them.
      const clearPunches = isLeave && !isHalfDayLeave;
      const inTime = isLeave
        ? clearPunches
          ? null
          : (existingDay?.inTime ?? null)
        : parsed.data.finalIn ?? reg.proposedIn ?? null;
      const outTime = isLeave
        ? clearPunches
          ? null
          : (existingDay?.outTime ?? null)
        : parsed.data.finalOut ?? reg.proposedOut ?? null;
      const workMinutes = isLeave
        ? clearPunches
          ? null
          : (existingDay?.workMinutes ?? null)
        : grossWorkMinutes(inTime, outTime);
      const targetStatus = isLeave ? leaveTargetStatus : parsed.data.finalStatus;
      // A declared half is only meaningful on an HD day. Write it through on a
      // half-day leave and clear it otherwise, so a day that stops being a
      // half-day never keeps a stale half hanging off it.
      const dayHalfSession = targetStatus === "HD" ? half : null;
      // Only a half-day LEAVE decision rules on pay. A punch correction that
      // lands on HD carries no such ruling, so it stays null — plain 0.5-day
      // loss-of-pay, which is what an undecided half-day has always been.
      const dayHalfPaid = isHalfDayLeave && targetStatus === "HD" ? isPaidLeave : null;
      const leaveLabel = isHalfDayLeave
        ? `${isPaidLeave ? "Paid" : "Unpaid"} half-day leave (${halfSessionLabel(half)?.toLowerCase()})`
        : isPaidLeave
          ? "Paid leave"
          : "Unpaid leave";
      const note = isLeave
        ? `${leaveLabel} approved · ${parsed.data.reviewNote ?? ""}`.trim()
        : `Regularized · ${parsed.data.reviewNote ?? ""}`.trim();
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
            halfSession: dayHalfSession,
            halfPaid: dayHalfPaid,
            ...(isHalfDayLeave ? {} : { otMinutes: 0 }),
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
              halfSession: dayHalfSession,
              halfPaid: dayHalfPaid,
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
          requestType: reg.requestType,
          halfSession: reg.requestType === "leave" ? half : null,
          leaveStatus: reg.requestType === "leave" ? parsed.data.leaveStatus : null,
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
  if (parsed.data.decision === "approve" && !isNote) {
    // The approved correction changed the day's status, which can create or
    // dissolve a sandwich bracket — re-reconcile the employee's cycle. This
    // both flips newly-sandwiched WO/HL and reverts prior flips that no longer
    // apply (e.g. a punch fix turning an absence anchor into Present).
    const { start, end } = cycleWindowForMonth(cycleMonthForDate(reg.date));
    await applySandwichRule({ employeeId: reg.employee.id, windowStart: start, windowEnd: end, actorUserId: userId ?? null });
    await recomputeLeaveBalance(reg.employee.id, reg.date.getUTCFullYear());
  }

  // Tell the employee what was decided — including, on an approved leave,
  // whether it was granted paid or unpaid, which affects their pay and was
  // not visible to them anywhere before.
  await notifyRequestDecided({
    employeeId: reg.employee.id,
    requestType: reg.requestType,
    halfSession: half,
    date: reg.date,
    decision: parsed.data.decision,
    leaveStatus: reg.requestType === "leave" ? parsed.data.leaveStatus : null,
    reviewNote: parsed.data.reviewNote ?? null,
  });

  return NextResponse.json({ ok: true, status: newStatus });
}
