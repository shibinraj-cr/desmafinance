import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { recomputeAfterShiftChange } from "@/lib/hr-attendance-ingest";

// Approving / editing / deleting re-derives stored attendance cycle by cycle.
export const maxDuration = 120;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PatchSchema = z.object({
  effectiveTo: z.string().regex(DATE_RE).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
  status: z.enum(["approved", "rejected"]).optional(),
  reviewNote: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const existing = await prisma.hrShiftAssignment.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.effectiveTo !== undefined) {
    data.effectiveTo = parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null;
  }
  if (parsed.data.reason !== undefined) data.reason = parsed.data.reason;
  if (parsed.data.status) {
    data.status = parsed.data.status;
    data.reviewedById = userId ?? null;
    data.reviewedAt = new Date();
    data.reviewNote = parsed.data.reviewNote ?? null;
  }
  const updated = await prisma.hrShiftAssignment.update({
    where: { id: params.id },
    data,
  });
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: parsed.data.status ? `shift_${parsed.data.status}` : "shift_assignment_updated",
      entityType: "HrShiftAssignment",
      entityId: params.id,
      metadata: { changes: parsed.data },
    },
  });
  // If newly approved + still effective, refresh the legacy
  // Employee.shiftId cache so the existing UI matches.
  if (parsed.data.status === "approved" && (!updated.effectiveTo || updated.effectiveTo >= new Date())) {
    await prisma.employee.update({
      where: { id: updated.employeeId },
      data: { shiftId: updated.shiftId },
    });
  }
  // Re-derive stored attendance whenever this row's effect on the timeline
  // moved — approved, rejected (an approved window withdrawn), or its end date
  // changed. A reason-only edit changes nothing. Always runs from the window
  // start to today, so days on BOTH sides of a moved end date are corrected.
  const statusChanged = !!parsed.data.status && parsed.data.status !== existing.status;
  const endMoved =
    parsed.data.effectiveTo !== undefined &&
    (data.effectiveTo as Date | null)?.getTime() !== existing.effectiveTo?.getTime();
  const touchesTimeline = existing.status === "approved" || updated.status === "approved";
  const recompute =
    touchesTimeline && (statusChanged || endMoved)
      ? await recomputeAfterShiftChange({
          employeeId: updated.employeeId,
          from: existing.effectiveFrom,
          actorUserId: userId ?? null,
        })
      : null;
  return NextResponse.json({ ok: true, recompute });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const existing = await prisma.hrShiftAssignment.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.hrShiftAssignment.delete({ where: { id: params.id } });
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: "shift_assignment_deleted",
      entityType: "HrShiftAssignment",
      entityId: params.id,
      metadata: {
        employeeId: existing.employeeId,
        shiftId: existing.shiftId,
        effectiveFrom: existing.effectiveFrom.toISOString().slice(0, 10),
      },
    },
  });
  // Deleting an approved window changes which shift those days resolve to.
  const recompute =
    existing.status === "approved"
      ? await recomputeAfterShiftChange({
          employeeId: existing.employeeId,
          from: existing.effectiveFrom,
          actorUserId: userId ?? null,
        })
      : null;
  return NextResponse.json({ ok: true, recompute });
}
