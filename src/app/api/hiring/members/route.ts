import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, conflict } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { HIRING_PERMISSIONS } from "@/lib/hiring/rbac";
import { recordHiringAudit } from "@/lib/hiring/audit";

export const dynamic = "force-dynamic";

const permissionKey = z.enum(HIRING_PERMISSIONS);
const baseRole = z.enum(["owner", "hr_manager", "recruiter", "employee"]);

const createSchema = z.object({
  userId: z.string().min(1),
  baseRole,
  customRoleName: z.string().trim().max(60).optional().nullable(),
  extraPermissions: z.array(permissionKey).max(HIRING_PERMISSIONS.length).default([]),
  deniedPermissions: z.array(permissionKey).max(HIRING_PERMISSIONS.length).default([]),
});

// GET /api/hiring/members — the hiring team table.
export const GET = withApiHandler(async () => {
  await requireHiring("team:manage");
  const members = await prisma.hiringMember.findMany({
    include: { user: { select: { id: true, username: true, email: true } } },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ members });
});

// POST /api/hiring/members — put an existing Desgro user on the hiring team.
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("team:manage");
  const body = createSchema.parse(await req.json());

  const user = await prisma.user.findUnique({
    where: { id: body.userId },
    select: { id: true, isActive: true },
  });
  if (!user) throw badRequest("That user no longer exists.", "unknown_user");
  if (!user.isActive) throw badRequest("That account is deactivated.", "inactive_user");

  const existing = await prisma.hiringMember.findUnique({ where: { userId: body.userId } });
  if (existing) throw conflict("That person is already on the hiring team.", "already_member");

  const member = await prisma.hiringMember.create({
    data: {
      userId: body.userId,
      baseRole: body.baseRole,
      customRoleName: body.customRoleName?.trim() || null,
      extraPermissions: body.extraPermissions,
      deniedPermissions: body.deniedPermissions,
      invitedById: access.userId,
    },
  });

  await recordHiringAudit({
    actorId: access.userId,
    action: "member.create",
    entityType: "HiringMember",
    entityId: member.id,
    after: member,
  });

  return NextResponse.json({ member }, { status: 201 });
});
