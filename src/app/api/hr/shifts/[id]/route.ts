import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const PatchSchema = z.object({
  code: z.string().min(1).max(8).optional(),
  name: z.string().min(1).optional(),
  startTime: z.string().regex(TIME_RE).optional(),
  endTime: z.string().regex(TIME_RE).optional(),
  graceMinutes: z.number().int().min(0).max(120).optional(),
  halfDayCutoffTime: z.string().regex(TIME_RE).nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const shift = await prisma.hrShift.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ shift });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const inUse = await prisma.employee.count({ where: { shiftId: params.id } });
  if (inUse > 0) {
    await prisma.hrShift.update({ where: { id: params.id }, data: { active: false } });
    return NextResponse.json({ deactivated: true, employees: inUse });
  }
  await prisma.hrShift.delete({ where: { id: params.id } });
  return NextResponse.json({ deleted: true });
}
