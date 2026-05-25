import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

const Schema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().nullable().optional(),
  headEmployeeId: z.string().nullable().optional(),
  active: z.boolean().default(true),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await prisma.hrDepartment.findMany({
    orderBy: { name: "asc" },
    include: {
      headEmployee: { select: { id: true, empCode: true, name: true } },
      _count: { select: { members: true } },
    },
  });
  return NextResponse.json({ departments: rows });
}

export async function POST(req: Request) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const row = await prisma.hrDepartment.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      headEmployeeId: parsed.data.headEmployeeId || null,
      active: parsed.data.active,
    },
  });
  return NextResponse.json({ department: row });
}
