import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

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
  return NextResponse.json({ ok: true });
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
  return NextResponse.json({ ok: true });
}
