import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const CreateSchema = z.object({
  name: z.string().min(2).max(160),
  description: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export const dynamic = "force-dynamic";

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const services = await prisma.service.findMany({
    orderBy: [{ name: "asc" }],
    include: { _count: { select: { subItems: true } } },
  });
  return NextResponse.json({ services });
}

export async function POST(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const data = parsed.data;
  const name = data.name.trim();

  const existing = await prisma.service.findUnique({ where: { name } });
  if (existing) return NextResponse.json({ error: "name_taken" }, { status: 409 });

  const created = await prisma.service.create({
    data: {
      name,
      description: data.description && data.description.length > 0 ? data.description.trim() : null,
      isActive: data.isActive,
      isSystem: false,
    },
  });
  await recordAudit({
    entityType: "Service",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { name, description: data.description ?? null },
  });
  return NextResponse.json({ service: created });
}
