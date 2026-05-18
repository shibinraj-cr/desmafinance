import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  serviceId: z.string().min(1),
  showInL2Targets: z.boolean().optional(),
  weight: z.number().min(0).max(100).optional(),
});

/**
 * PATCH — supervisor updates Show/Hide or the weight of a service
 * on the L2 Targets matrix. At least one field must be supplied.
 */
export async function PATCH(req: NextRequest) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return NextResponse.json({ error: "forbidden_supervisor_only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { serviceId, showInL2Targets, weight } = parsed.data;
  if (showInL2Targets === undefined && weight === undefined) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }
  const svc = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!svc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.service.update({
    where: { id: serviceId },
    data: {
      ...(showInL2Targets !== undefined ? { showInL2Targets } : {}),
      ...(weight !== undefined ? { weight } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
