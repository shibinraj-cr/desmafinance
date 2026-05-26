import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const Patch = z.object({
  name: z.string().min(1).max(80).optional(),
  level: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const row = await prisma.hrDesignation.update({
    where: { id: params.id },
    data: parsed.data,
  });
  return NextResponse.json({ designation: row });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const inUse = await prisma.employee.count({ where: { designationId: params.id } });
  if (inUse > 0) {
    // Soft delete via active=false to preserve FK + history.
    await prisma.hrDesignation.update({
      where: { id: params.id },
      data: { active: false },
    });
    return NextResponse.json({ deactivated: true, employeesLinked: inUse });
  }
  await prisma.hrDesignation.delete({ where: { id: params.id } });
  return NextResponse.json({ deleted: true });
}
