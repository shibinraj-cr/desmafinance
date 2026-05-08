import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const CreateSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(160),
  isActive: z.boolean().default(true),
});

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

  const cat = await prisma.category.findUnique({ where: { id: data.categoryId } });
  if (!cat) return NextResponse.json({ error: "category_not_found" }, { status: 400 });

  const existing = await prisma.subCategory.findUnique({
    where: { categoryId_name: { categoryId: cat.id, name } },
  });
  if (existing) return NextResponse.json({ error: "name_taken" }, { status: 409 });
  const created = await prisma.subCategory.create({
    data: { categoryId: cat.id, name, isActive: data.isActive, isSystem: false },
  });
  await recordAudit({
    entityType: "SubCategory",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { categoryId: cat.id, categoryName: cat.name, name },
  });
  return NextResponse.json({ subCategory: created });
}
