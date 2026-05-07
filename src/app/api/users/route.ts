import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers, ROLES } from "@/lib/rbac";

const CreateSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-zA-Z0-9._@-]+$/, "Use letters, numbers, . _ @ -"),
  email: z.string().email().max(120).optional().or(z.literal("")),
  password: z.string().min(8).max(200),
  role: z.enum(ROLES),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(session.user.role))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(session.user.role))
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
    data: { username, email, passwordHash, role: data.role },
    select: { id: true, username: true, email: true, role: true, createdAt: true },
  });

  await recordAudit({
    entityType: "User",
    entityId: created.id,
    action: "CREATE",
    userId: session.user.id,
    changes: { username: created.username, email: created.email, role: created.role },
  });

  return NextResponse.json({ user: created });
}
