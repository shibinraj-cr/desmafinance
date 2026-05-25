import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const Patch = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().nullable().optional(),
  headEmployeeId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const data: Record<string, unknown> = { ...parsed.data };
  if (data.headEmployeeId === "") data.headEmployeeId = null;
  const row = await prisma.hrDepartment.update({ where: { id: params.id }, data });
  return NextResponse.json({ department: row });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const inUse = await prisma.hrEmployeeDepartment.count({ where: { departmentId: params.id } });
  if (inUse > 0) {
    await prisma.hrDepartment.update({ where: { id: params.id }, data: { active: false } });
    return NextResponse.json({ deactivated: true, membersLinked: inUse });
  }
  await prisma.hrDepartment.delete({ where: { id: params.id } });
  return NextResponse.json({ deleted: true });
}
