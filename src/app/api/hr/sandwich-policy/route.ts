import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

const Schema = z.object({
  departmentId: z.string().nullable(),
  enabled: z.boolean(),
  includeHolidays: z.boolean(),
  includeWeekOffs: z.boolean(),
  maxGapDays: z.number().int().min(1).max(31),
  notes: z.string().max(500).nullable().optional(),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const policies = await prisma.hrSandwichPolicy.findMany({
    include: { department: { select: { name: true } } },
    orderBy: [{ departmentId: "asc" }],
  });
  return NextResponse.json({ policies });
}

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const existing = await prisma.hrSandwichPolicy.findFirst({
    where: { departmentId: parsed.data.departmentId },
  });
  const saved = existing
    ? await prisma.hrSandwichPolicy.update({ where: { id: existing.id }, data: parsed.data })
    : await prisma.hrSandwichPolicy.create({ data: parsed.data });
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: "sandwich_policy_saved",
      entityType: "HrSandwichPolicy",
      entityId: saved.id,
      metadata: parsed.data,
    },
  });
  return NextResponse.json({ policy: saved });
}
