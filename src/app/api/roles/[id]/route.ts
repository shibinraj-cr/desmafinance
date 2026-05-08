import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { ALL_PAGE_HREFS } from "@/lib/pages";

const PatchSchema = z.object({
  description: z.string().max(200).optional().or(z.literal("")),
  isAdmin: z.boolean().optional(),
  canApprove: z.boolean().optional(),
  needsApproval: z.boolean().optional(),
  pages: z.array(z.string()).optional(),
  /** Custom roles only — system roles can't be renamed. */
  name: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-zA-Z0-9 _-]+$/)
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const data = parsed.data;

  const role = await prisma.role.findUnique({ where: { id: params.id } });
  if (!role) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Don't accidentally lock yourself out: if removing isAdmin, ensure another
  // admin role still exists.
  if (role.isAdmin && data.isAdmin === false) {
    const adminUserCount = await prisma.user.count({
      where: { roleRef: { isAdmin: true } },
    });
    if (adminUserCount <= 1 && (await prisma.user.count({ where: { roleId: role.id } })) > 0) {
      return NextResponse.json({ error: "cannot_demote_last_admin_role" }, { status: 409 });
    }
  }

  const allowed = new Set(ALL_PAGE_HREFS);
  const update: Record<string, unknown> = {};
  if (data.description !== undefined) update.description = data.description || null;
  if (data.isAdmin !== undefined) update.isAdmin = data.isAdmin;
  if (data.canApprove !== undefined) update.canApprove = data.canApprove;
  if (data.needsApproval !== undefined) update.needsApproval = data.needsApproval;
  if (data.pages) update.pages = data.pages.filter((p) => allowed.has(p));
  if (data.name && !role.isSystem) update.name = data.name.trim();

  const updated = await prisma.role.update({ where: { id: params.id }, data: update });
  await recordAudit({
    entityType: "Role",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: {
      before: {
        name: role.name,
        isAdmin: role.isAdmin,
        canApprove: role.canApprove,
        needsApproval: role.needsApproval,
        pages: role.pages,
      },
      after: data,
    },
  });
  return NextResponse.json({ role: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const role = await prisma.role.findUnique({
    where: { id: params.id },
    include: { _count: { select: { users: true } } },
  });
  if (!role) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (role.isSystem) return NextResponse.json({ error: "system_role" }, { status: 409 });
  if (role._count.users > 0) {
    return NextResponse.json({ error: "role_in_use" }, { status: 409 });
  }

  await prisma.role.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "Role",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { name: role.name },
  });
  return NextResponse.json({ ok: true });
}
