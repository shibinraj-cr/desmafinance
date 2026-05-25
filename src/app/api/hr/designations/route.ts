import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

const Schema = z.object({
  name: z.string().min(1).max(80),
  level: z.number().int().min(0).max(1000).default(0),
  active: z.boolean().default(true),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await prisma.hrDesignation.findMany({
    orderBy: [{ level: "desc" }, { name: "asc" }],
    include: { _count: { select: { employees: true } } },
  });
  return NextResponse.json({ designations: rows });
}

export async function POST(req: Request) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const row = await prisma.hrDesignation.create({ data: parsed.data });
  return NextResponse.json({ designation: row });
}
