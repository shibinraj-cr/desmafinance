import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess, LEAD_PULSE_ROLE_SLUGS } from "@/lib/lead-pulse-rbac";

const PatchSchema = z.object({
  role: z.enum(LEAD_PULSE_ROLE_SLUGS).optional(),
  displayName: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).nullable().optional(),
  regionFocus: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId: actorId, perms } = await getCurrentUserAndPermissions();
  if (!actorId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(actorId, perms);
  if (!access.canSupervise)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const data = parsed.data;

  const existing = await prisma.leadPulseRole.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (data.regionFocus && data.regionFocus.length) {
    const regions = await prisma.leadPulseRegion.findMany({
      where: { code: { in: data.regionFocus } },
      select: { code: true },
    });
    const valid = new Set(regions.map((r) => r.code));
    if (data.regionFocus.some((c) => !valid.has(c))) {
      return NextResponse.json({ error: "invalid_region_code" }, { status: 400 });
    }
  }

  const update: Record<string, unknown> = {};
  if (data.role !== undefined) update.role = data.role;
  if (data.displayName !== undefined) update.displayName = data.displayName.trim();
  if (data.phone !== undefined) update.phone = data.phone?.trim() || null;
  if (data.regionFocus !== undefined) update.regionFocus = data.regionFocus;
  if (data.active !== undefined) update.active = data.active;

  const updated = await prisma.leadPulseRole.update({
    where: { id: params.id },
    data: update,
  });
  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: actorId,
      eventType: "role_changed",
      targetId: updated.id,
      metadata: {
        before: existing,
        after: updated,
      },
    },
  });
  return NextResponse.json({ role: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId: actorId, perms } = await getCurrentUserAndPermissions();
  if (!actorId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(actorId, perms);
  if (!access.canSupervise)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const existing = await prisma.leadPulseRole.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.leadPulseRole.delete({ where: { id: params.id } });
  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: actorId,
      eventType: "role_changed",
      targetId: params.id,
      metadata: { removed: existing },
    },
  });
  return NextResponse.json({ ok: true });
}
