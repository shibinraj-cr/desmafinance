import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const PatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  type: z.enum(["Revenue", "Expense", "Both"]).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });

  const cat = await prisma.category.findUnique({ where: { id: params.id } });
  if (!cat) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const data = parsed.data;
  const update: Record<string, unknown> = {};
  if (data.name !== undefined) update.name = data.name.trim();
  if (data.type !== undefined) update.type = data.type;
  if (data.isActive !== undefined) update.isActive = data.isActive;

  // Don't allow rename if it would collide with an existing (name, type) pair.
  if (data.name || data.type) {
    const finalName = (data.name ?? cat.name).trim();
    const finalType = data.type ?? cat.type;
    const collision = await prisma.category.findUnique({
      where: { name_type: { name: finalName, type: finalType } },
    });
    if (collision && collision.id !== cat.id) {
      return NextResponse.json({ error: "name_taken" }, { status: 409 });
    }
  }

  const updated = await prisma.category.update({ where: { id: params.id }, data: update });
  await recordAudit({
    entityType: "Category",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: { before: { name: cat.name, type: cat.type, isActive: cat.isActive }, after: data },
  });
  return NextResponse.json({ category: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const cat = await prisma.category.findUnique({
    where: { id: params.id },
    include: { _count: { select: { subItems: true } } },
  });
  if (!cat) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Block delete if any active transaction references this category by name.
  const txCount = await prisma.transaction.count({
    where: { category: cat.name, deletedAt: null },
  });
  if (txCount > 0) {
    return NextResponse.json(
      { error: "in_use", txCount, message: "Set isActive=false to retire instead." },
      { status: 409 },
    );
  }

  await prisma.category.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "Category",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { name: cat.name, type: cat.type, subItemCount: cat._count.subItems },
  });
  return NextResponse.json({ ok: true });
}
