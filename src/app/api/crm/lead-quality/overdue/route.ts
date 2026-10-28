import { NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { qualityRemindersFor } from "@/lib/crm-lead-quality-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/lead-quality/overdue — the list behind the quality-rating
 * reminder (components/LeadQualityReminder): the caller's OWN leads whose
 * rating is overdue, plus the active reasons so Poor / Junk can be rated
 * without leaving the pop-up. Always scoped to the signed-in user.
 */
export async function GET() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json(await qualityRemindersFor(userId));
}
