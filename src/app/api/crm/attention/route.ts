import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { uncontactedAlarmScope } from "@/lib/crm-uncontacted-alarm";
import { uncontactedLeadsFor } from "@/lib/crm-uncontacted-leads";
import { qualityRemindersFor } from "@/lib/crm-lead-quality-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/attention?parts=uncontacted,quality — every CRM pop-up's data in
 * ONE poll (components/crm-attention-feed). Each part is computed exactly as its
 * own endpoint does — the uncontacted alarm's scope re-derived from the caller's
 * role, the quality list always the caller's own — so the pop-ups behave as
 * before; they just stop polling on separate clocks.
 */
export async function GET(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parts = new Set((new URL(req.url).searchParams.get("parts") ?? "").split(",").filter(Boolean));
  const out: Record<string, unknown> = {};

  if (parts.has("uncontacted")) {
    const lpRole = await prisma.leadPulseRole.findUnique({ where: { userId }, select: { role: true, active: true } });
    const scope = uncontactedAlarmScope(perms, lpRole);
    out.uncontacted = scope
      ? await uncontactedLeadsFor(userId, scope)
      : { scope: null, total: 0, leads: [], newStatusId: null };
  }
  if (parts.has("quality")) out.quality = await qualityRemindersFor(userId);

  return NextResponse.json(out);
}
