import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { ALL_PAGE_HREFS } from "@/lib/pages";

const CreateSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-zA-Z0-9 _-]+$/, "Use letters, numbers, spaces, _ -"),
  description: z.string().max(200).optional().or(z.literal("")),
  isAdmin: z.boolean().default(false),
  canApprove: z.boolean().default(false),
  needsApproval: z.boolean().default(true),
  pages: z.array(z.string()).default([]),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const roles = await prisma.role.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: { _count: { select: { users: true } } },
  });
  return NextResponse.json({ roles });
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
  const allowed = new Set(ALL_PAGE_HREFS);
  const pages = data.pages.filter((p) => allowed.has(p));

  const existing = await prisma.role.findUnique({ where: { name: data.name } });
  if (existing) return NextResponse.json({ error: "name_taken" }, { status: 409 });

  const created = await prisma.role.create({
    data: {
      name: data.name.trim(),
      description: data.description || null,
      isAdmin: data.isAdmin,
      canApprove: data.canApprove,
      needsApproval: data.needsApproval,
      pages,
      isSystem: false,
    },
  });
  await recordAudit({
    entityType: "Role",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { ...data, pages },
  });
  return NextResponse.json({ role: created });
}
