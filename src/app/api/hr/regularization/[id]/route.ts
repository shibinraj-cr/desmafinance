import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { recomputeLeaveBalance } from "@/lib/hr-leave-balance";
import { applySandwichRule } from "@/lib/hr-sandwich";
import { cycleWindowForMonth, cycleMonthForDate } from "@/lib/hr-data";
import { resolveShiftForDate } from "@/lib/hr-shift";

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
      // Leave request → the day becomes paid leave (LV); no punch is involved.
      const isLeave = reg.requestType === "leave";
      const inTime = isLeave ? null : parsed.data.finalIn ?? reg.proposedIn ?? null;
      const outTime = isLeave ? null : parsed.data.finalOut ?? reg.proposedOut ?? null;
      const workMinutes = isLeave ? null : grossWorkMinutes(inTime, outTime);
      const targetStatus = isLeave ? "LV" : parsed.data.finalStatus;
      const note = isLeave
        ? `Leave approved · ${parsed.data.reviewNote ?? ""}`.trim()
        : `Regularized · ${parsed.data.reviewNote ?? ""}`.trim();
      if (reg.attendanceDayId) {
        await tx.hrAttendanceDay.update({
          where: { id: reg.attendanceDayId },
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
          },
        });
      } else {
        // No attendance row yet. Use the most recent upload as parent
        // so HrAttendanceUpload aggregations still work; if there are
        // no uploads at all, skip the day-row write and surface a
        // soft warning.
        const upload = await tx.hrAttendanceUpload.findFirst({
          orderBy: { uploadedAt: "desc" },
          select: { id: true },
        });
        if (upload) {
          await tx.hrAttendanceDay.create({
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
              remark: isLeave ? "Leave (regularization)" : `Regularized · ${reg.reasonType}`,
              decidedById: userId ?? null,
              decidedAt: now,
              decisionNote: parsed.data.reviewNote ?? null,
            },
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
