import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

const PatchSchema = z.object({
  label: z.string().min(2).max(80).optional(),
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

  const existing = await prisma.leadPulseRegion.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) update.label = parsed.data.label.trim();
  if (parsed.data.active !== undefined) update.active = parsed.data.active;

  const updated = await prisma.leadPulseRegion.update({ where: { id: params.id }, data: update });
  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: actorId,
      eventType: parsed.data.active === false ? "region_disabled" : "region_added",
      targetId: updated.id,
      metadata: { before: existing, after: parsed.data },
    },
  });
  return NextResponse.json({ region: updated });
}
