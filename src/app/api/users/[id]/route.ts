import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers, ROLES } from "@/lib/rbac";

const PatchSchema = z.object({
  role: z.enum(ROLES).optional(),
  email: z.string().email().max(120).optional().or(z.literal("")),
  password: z.string().min(8).max(200).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(session.user.role))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const data = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Don't let an admin demote themselves out of the only admin seat.
  if (data.role && data.role !== "admin" && target.role === "admin") {
    const adminCount = await prisma.user.count({ where: { role: "admin" } });
    if (adminCount <= 1) {
      return NextResponse.json({ error: "cannot_demote_last_admin" }, { status: 409 });
    }
  }

  const update: Record<string, unknown> = {};
  if (data.role) update.role = data.role;
  if (data.email !== undefined) update.email = data.email ? data.email.trim().toLowerCase() : null;
  if (data.password) update.passwordHash = await bcrypt.hash(data.password, 12);

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: update,
    select: { id: true, username: true, email: true, role: true, updatedAt: true },
  });

  await recordAudit({
    entityType: "User",
    entityId: updated.id,
    action: "UPDATE",
    userId: session.user.id,
    changes: {
      before: { role: target.role, email: target.email },
      after: { role: updated.role, email: updated.email },
      passwordChanged: !!data.password,
    },
  });

  return NextResponse.json({ user: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(session.user.role))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (params.id === session.user.id) {
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 409 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (target.role === "admin") {
    const adminCount = await prisma.user.count({ where: { role: "admin" } });
    if (adminCount <= 1) {
      return NextResponse.json({ error: "cannot_delete_last_admin" }, { status: 409 });
    }
  }

  await prisma.user.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "User",
    entityId: params.id,
    action: "DELETE",
    userId: session.user.id,
    changes: { username: target.username, role: target.role },
  });

  return NextResponse.json({ ok: true });
}
