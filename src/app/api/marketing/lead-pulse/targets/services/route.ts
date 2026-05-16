import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  serviceId: z.string().min(1),
  showInL2Targets: z.boolean(),
});

/** PATCH — supervisor toggles whether a service shows on the L2 Targets matrix. */
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
  const { serviceId, showInL2Targets } = parsed.data;
  const svc = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!svc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.service.update({
    where: { id: serviceId },
    data: { showInL2Targets },
  });
  return NextResponse.json({ ok: true });
}
