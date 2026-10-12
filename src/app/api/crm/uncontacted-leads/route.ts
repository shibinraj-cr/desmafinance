import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { uncontactedAlarmScope } from "@/lib/crm-uncontacted-alarm";
import { uncontactedLeadsFor } from "@/lib/crm-uncontacted-leads";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/uncontacted-leads — the list behind the uncontacted-lead pop-up,
 * polled by components/UncontactedLeadAlarm. The scope (own leads vs the whole
 * team) is re-derived here from the caller's role, never taken from the client.
 * Anyone the alarm isn't for gets `scope: null` and an empty list.
 */
export async function GET() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const lpRole = await prisma.leadPulseRole.findUnique({
    where: { userId },
    select: { role: true, active: true },
  });
  const scope = uncontactedAlarmScope(perms, lpRole);
  if (!scope) return NextResponse.json({ scope: null, total: 0, leads: [], newStatusId: null });

  return NextResponse.json(await uncontactedLeadsFor(userId, scope));
}
