import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const PatchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
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

  const sub = await prisma.subCategory.findUnique({ where: { id: params.id } });
  if (!sub) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const data = parsed.data;
  const update: Record<string, unknown> = {};
  if (data.name !== undefined) {
    const newName = data.name.trim();
    if (newName !== sub.name) {
      const collision = await prisma.subCategory.findUnique({
        where: { categoryId_name: { categoryId: sub.categoryId, name: newName } },
      });
      if (collision && collision.id !== sub.id) {
        return NextResponse.json({ error: "name_taken" }, { status: 409 });
      }
      update.name = newName;
    }
  }
  if (data.isActive !== undefined) update.isActive = data.isActive;

  const updated = await prisma.subCategory.update({ where: { id: params.id }, data: update });
  await recordAudit({
    entityType: "SubCategory",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: { before: { name: sub.name, isActive: sub.isActive }, after: data },
  });
  return NextResponse.json({ subCategory: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const sub = await prisma.subCategory.findUnique({ where: { id: params.id } });
  if (!sub) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const txCount = await prisma.transaction.count({
    where: { subItem: sub.name, deletedAt: null },
  });
  if (txCount > 0) {
    return NextResponse.json(
      { error: "in_use", txCount, message: "Set isActive=false to retire instead." },
      { status: 409 },
    );
  }

  await prisma.subCategory.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "SubCategory",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { categoryId: sub.categoryId, name: sub.name },
  });
  return NextResponse.json({ ok: true });
}
