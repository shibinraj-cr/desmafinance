import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const existing = await prisma.hrSandwichPolicy.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.hrSandwichPolicy.delete({ where: { id: params.id } });
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: "sandwich_policy_deleted",
      entityType: "HrSandwichPolicy",
      entityId: params.id,
      metadata: { departmentId: existing.departmentId },
    },
  });
  return NextResponse.json({ ok: true });
}
