import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const TypeEnum = z.enum(["Revenue", "Expense", "Both"]);

const CreateSchema = z.object({
  name: z.string().min(2).max(120),
  type: TypeEnum,
  isActive: z.boolean().default(true),
});

export const dynamic = "force-dynamic";

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cats = await prisma.category.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: {
      subItems: { orderBy: { name: "asc" } },
    },
  });
  return NextResponse.json({ categories: cats });
}

export async function POST(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const data = parsed.data;
  const name = data.name.trim();
  const existing = await prisma.category.findUnique({
    where: { name_type: { name, type: data.type } },
  });
  if (existing) return NextResponse.json({ error: "name_taken" }, { status: 409 });
  const created = await prisma.category.create({
    data: { name, type: data.type, isActive: data.isActive, isSystem: false },
  });
  await recordAudit({
    entityType: "Category",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { name, type: data.type },
  });
  return NextResponse.json({ category: created });
}
