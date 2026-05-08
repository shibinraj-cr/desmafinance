import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const CreateSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-zA-Z0-9._@-]+$/, "Use letters, numbers, . _ @ -"),
  email: z.string().email().max(120).optional().or(z.literal("")),
  password: z.string().min(8).max(200),
  /** Role can be a built-in name or a custom role's id. Resolve server-side. */
  roleId: z.string().min(1).optional(),
  roleName: z.string().min(1).max(60).optional(),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      roleId: true,
      roleRef: { select: { id: true, name: true } },
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if ((req.headers.get("content-type") ?? "").split(";")[0].trim() !== "application/json") {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const data = parsed.data;
  const username = data.username.trim().toLowerCase();
  const email = data.email && data.email.length > 0 ? data.email.trim().toLowerCase() : null;

  // Resolve the chosen role.
  let roleId: string | null = null;
  let legacyRoleName = "executive";
  if (data.roleId) {
    const r = await prisma.role.findUnique({ where: { id: data.roleId } });
    if (!r) return NextResponse.json({ error: "role_not_found" }, { status: 400 });
    roleId = r.id;
    legacyRoleName = legacyForRole(r.name);
  } else if (data.roleName) {
    const r = await prisma.role.findUnique({ where: { name: data.roleName } });
    if (!r) return NextResponse.json({ error: "role_not_found" }, { status: 400 });
    roleId = r.id;
    legacyRoleName = legacyForRole(r.name);
  } else {
    // Default to Executive if nothing specified.
    const r = await prisma.role.findUnique({ where: { name: "Executive" } });
    if (r) {
      roleId = r.id;
    }
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "username_taken" }, { status: 409 });
  }
  if (email) {
    const e = await prisma.user.findUnique({ where: { email } });
    if (e) return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const created = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      role: legacyRoleName,
      roleId,
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      roleId: true,
      roleRef: { select: { id: true, name: true } },
      createdAt: true,
    },
  });

  await recordAudit({
    entityType: "User",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: {
      username: created.username,
      email: created.email,
      role: created.role,
      roleName: created.roleRef?.name ?? null,
    },
  });

  return NextResponse.json({ user: created });
}

function legacyForRole(roleName: string): string {
  if (roleName === "Admin") return "admin";
  // Anything called "Manager" or "<X> Manager" maps to legacy "manager".
  if (/manager/i.test(roleName)) return "manager";
  // Default — including Executive variants and custom roles — uses the
  // least-privileged legacy value.
  return "executive";
}
