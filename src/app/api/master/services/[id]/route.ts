import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const PatchSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  description: z.string().max(500).optional().or(z.literal("")),
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

  const service = await prisma.service.findUnique({ where: { id: params.id } });
  if (!service) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const data = parsed.data;
  const update: Record<string, unknown> = {};
  if (data.name !== undefined) {
    const newName = data.name.trim();
    if (newName !== service.name) {
      const collision = await prisma.service.findUnique({ where: { name: newName } });
      if (collision && collision.id !== service.id) {
        return NextResponse.json({ error: "name_taken" }, { status: 409 });
      }
      update.name = newName;
    }
  }
  if (data.description !== undefined)
    update.description =
      data.description && data.description.length > 0 ? data.description.trim() : null;
  if (data.isActive !== undefined) update.isActive = data.isActive;

  const updated = await prisma.service.update({ where: { id: params.id }, data: update });
  await recordAudit({
    entityType: "Service",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: {
      before: {
        name: service.name,
        description: service.description,
        isActive: service.isActive,
      },
      after: data,
    },
  });
  return NextResponse.json({ service: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const service = await prisma.service.findUnique({
    where: { id: params.id },
    include: { _count: { select: { subItems: true } } },
  });
  if (!service) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (service._count.subItems > 0) {
    return NextResponse.json(
      { error: "in_use", message: "Unlink the sub-items first or set isActive=false." },
      { status: 409 },
    );
  }

  await prisma.service.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "Service",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { name: service.name },
  });
  return NextResponse.json({ ok: true });
}
