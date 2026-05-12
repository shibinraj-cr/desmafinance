import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess, LEAD_PULSE_ROLE_SLUGS } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(LEAD_PULSE_ROLE_SLUGS),
  displayName: z.string().min(1).max(120).optional(),
  regionFocus: z.array(z.string()).optional(),
  active: z.boolean().default(true),
});

export async function GET() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const roles = await prisma.leadPulseRole.findMany({
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
    include: {
      user: { select: { id: true, username: true, email: true } },
    },
  });
  return NextResponse.json({ roles });
}

export async function POST(req: NextRequest) {
  const { userId: actorId, perms } = await getCurrentUserAndPermissions();
  if (!actorId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(actorId, perms);
  if (!access.canSupervise)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const data = parsed.data;

  // Target user must exist in DESGRO.
  const target = await prisma.user.findUnique({ where: { id: data.userId } });
  if (!target) return NextResponse.json({ error: "user_not_found" }, { status: 400 });

  // Validate region codes if supplied.
  if (data.regionFocus && data.regionFocus.length) {
    const regions = await prisma.leadPulseRegion.findMany({
      where: { code: { in: data.regionFocus } },
      select: { code: true },
    });
    const validCodes = new Set(regions.map((r) => r.code));
    if (data.regionFocus.some((c) => !validCodes.has(c))) {
      return NextResponse.json({ error: "invalid_region_code" }, { status: 400 });
    }
  }

  const displayName = data.displayName?.trim() || target.username;
  const upserted = await prisma.leadPulseRole.upsert({
    where: { userId: data.userId },
    update: {
      role: data.role,
      displayName,
      regionFocus: data.regionFocus ?? [],
      active: data.active,
    },
    create: {
      userId: data.userId,
      role: data.role,
      displayName,
      regionFocus: data.regionFocus ?? [],
      active: data.active,
    },
  });

  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: actorId,
      eventType: "role_assigned",
      targetId: upserted.id,
      metadata: {
        userId: data.userId,
        role: data.role,
        displayName,
        regionFocus: data.regionFocus ?? [],
      },
    },
  });

  return NextResponse.json({ role: upserted });
}
