import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const PatchSchema = z.object({
  /** Set the user's role by Role.id (preferred) or by Role.name. */
  roleId: z.string().min(1).optional(),
  roleName: z.string().min(1).max(60).optional(),
  email: z.string().email().max(120).optional().or(z.literal("")),
  password: z.string().min(8).max(200).optional(),
  /** Soft-disable / re-enable the account (keeps all data; blocks sign-in). */
  isActive: z.boolean().optional(),
  /** Change the login username (e.g. an empCode-based one to a name-based one). */
  username: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-zA-Z0-9._@-]+$/, "Use letters, numbers, . _ @ -")
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

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    include: { roleRef: true },
  });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Resolve the new role if any.
  let newRoleRecord: { id: string; name: string; isAdmin: boolean } | null = null;
  if (data.roleId) {
    const r = await prisma.role.findUnique({ where: { id: data.roleId } });
    if (!r) return NextResponse.json({ error: "role_not_found" }, { status: 400 });
    newRoleRecord = r;
  } else if (data.roleName) {
    const r = await prisma.role.findUnique({ where: { name: data.roleName } });
    if (!r) return NextResponse.json({ error: "role_not_found" }, { status: 400 });
    newRoleRecord = r;
  }

  // Don't let an admin demote themselves out of the only admin seat.
  if (
    newRoleRecord &&
    !newRoleRecord.isAdmin &&
    target.roleRef?.isAdmin === true
  ) {
    const adminCount = await prisma.user.count({
      where: { roleRef: { isAdmin: true }, isActive: true },
    });
    if (adminCount <= 1) {
      return NextResponse.json({ error: "cannot_demote_last_admin" }, { status: 409 });
    }
  }

  // Guard soft-disable: can't lock yourself out, can't disable the last admin.
  if (data.isActive === false) {
    if (params.id === userId) {
      return NextResponse.json({ error: "cannot_deactivate_self" }, { status: 409 });
    }
    if (target.roleRef?.isAdmin) {
      const activeAdmins = await prisma.user.count({
        where: { roleRef: { isAdmin: true }, isActive: true },
      });
      if (activeAdmins <= 1) {
        return NextResponse.json({ error: "cannot_deactivate_last_admin" }, { status: 409 });
      }
    }
  }

  let newUsername: string | null = null;
  if (data.username !== undefined) {
    newUsername = data.username.trim().toLowerCase();
    if (newUsername !== target.username) {
      const clash = await prisma.user.findUnique({ where: { username: newUsername } });
      if (clash) return NextResponse.json({ error: "username_taken" }, { status: 409 });
    }
  }

  const update: Record<string, unknown> = {};
  if (data.isActive !== undefined) update.isActive = data.isActive;
  if (newRoleRecord) {
    update.roleId = newRoleRecord.id;
    update.role = legacyForRole(newRoleRecord.name);
  }
  if (data.email !== undefined) update.email = data.email ? data.email.trim().toLowerCase() : null;
  if (data.password) update.passwordHash = await bcrypt.hash(data.password, 12);
  if (newUsername !== null) update.username = newUsername;

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: update,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      roleId: true,
      isActive: true,
      roleRef: { select: { id: true, name: true } },
      updatedAt: true,
    },
  });

  await recordAudit({
    entityType: "User",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: {
      before: {
        username: target.username,
        roleName: target.roleRef?.name ?? target.role,
        email: target.email,
        isActive: target.isActive,
      },
      after: {
        username: updated.username,
        roleName: updated.roleRef?.name ?? updated.role,
        email: updated.email,
        isActive: updated.isActive,
      },
      passwordChanged: !!data.password,
    },
  });

  return NextResponse.json({ user: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (params.id === userId) {
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 409 });
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    include: { roleRef: true },
  });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (target.roleRef?.isAdmin) {
    const adminCount = await prisma.user.count({
      where: { roleRef: { isAdmin: true }, isActive: true },
    });
    if (adminCount <= 1) {
      return NextResponse.json({ error: "cannot_delete_last_admin" }, { status: 409 });
    }
  }

  await prisma.user.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "User",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: {
      username: target.username,
      roleName: target.roleRef?.name ?? target.role,
    },
  });

  return NextResponse.json({ ok: true });
}

function legacyForRole(roleName: string): string {
  if (roleName === "Admin") return "admin";
  if (/manager/i.test(roleName)) return "manager";
  return "executive";
}
