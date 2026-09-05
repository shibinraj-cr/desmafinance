import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, badRequest } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { HIRING_PERMISSIONS } from "@/lib/hiring/rbac";
import { recordHiringAudit } from "@/lib/hiring/audit";

export const dynamic = "force-dynamic";

const permissionKey = z.enum(HIRING_PERMISSIONS);

const patchSchema = z
  .object({
    baseRole: z.enum(["owner", "hr_manager", "recruiter", "employee"]).optional(),
    customRoleName: z.string().trim().max(60).nullable().optional(),
    extraPermissions: z.array(permissionKey).optional(),
    deniedPermissions: z.array(permissionKey).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

type Ctx = { params: { id: string } };

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireHiring("team:manage");
  const body = patchSchema.parse(await req.json());

  const before = await prisma.hiringMember.findUnique({ where: { id: params.id } });
  if (!before) throw notFound("That team member no longer exists.");

  // Don't let the last owner demote or deactivate themselves out of the
  // workspace — someone must always be able to grant access back.
  const losingOwner =
    before.baseRole === "owner" &&
    ((body.baseRole && body.baseRole !== "owner") || body.isActive === false);
  if (losingOwner) {
    const otherOwners = await prisma.hiringMember.count({
      where: { baseRole: "owner", isActive: true, id: { not: before.id } },
    });
    if (otherOwners === 0) {
      throw badRequest(
        "This is the last hiring Owner — promote someone else first.",
        "last_owner",
      );
    }
  }

  const member = await prisma.hiringMember.update({
    where: { id: params.id },
    data: {
      baseRole: body.baseRole,
      customRoleName:
        body.customRoleName === undefined ? undefined : body.customRoleName?.trim() || null,
      extraPermissions: body.extraPermissions,
      deniedPermissions: body.deniedPermissions,
      isActive: body.isActive,
    },
  });

  await recordHiringAudit({
    actorId: access.userId,
    action: "member.update",
    entityType: "HiringMember",
    entityId: member.id,
    before,
    after: member,
  });

  return NextResponse.json({ member });
});

// Removing someone from the hiring team never touches their Desgro login —
// they simply fall back to the page-grant floor (usually: nothing).
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireHiring("team:manage");
  const before = await prisma.hiringMember.findUnique({ where: { id: params.id } });
  if (!before) throw notFound("That team member no longer exists.");

  if (before.baseRole === "owner") {
    const otherOwners = await prisma.hiringMember.count({
      where: { baseRole: "owner", isActive: true, id: { not: before.id } },
    });
    if (otherOwners === 0) {
      throw badRequest("This is the last hiring Owner — promote someone else first.", "last_owner");
    }
  }

  await prisma.hiringMember.delete({ where: { id: params.id } });
  await recordHiringAudit({
    actorId: access.userId,
    action: "member.delete",
    entityType: "HiringMember",
    entityId: params.id,
    before,
  });

  return NextResponse.json({ ok: true });
});
