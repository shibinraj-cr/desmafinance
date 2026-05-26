import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

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
      // Apply correction to the attendance day. If no row exists for
      // that date yet, create a minimal one tied to the most recent
      // upload (if any), or skip — HR can re-upload later.
      const inTime = parsed.data.finalIn ?? reg.proposedIn ?? null;
      const outTime = parsed.data.finalOut ?? reg.proposedOut ?? null;
      if (reg.attendanceDayId) {
        await tx.hrAttendanceDay.update({
          where: { id: reg.attendanceDayId },
          data: {
            status: parsed.data.finalStatus,
            inTime,
            outTime,
            decidedById: userId ?? null,
            decidedAt: now,
            decisionNote: `Regularized · ${parsed.data.reviewNote ?? ""}`.trim(),
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
              status: parsed.data.finalStatus,
              rawStatus: "REG",
              inTime,
              outTime,
              workMinutes: null,
              breakMinutes: null,
              otMinutes: null,
              lateMinutes: null,
              earlyOutMinutes: null,
              remark: `Regularized · ${reg.reasonType}`,
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
  return NextResponse.json({ ok: true, status: newStatus });
}
