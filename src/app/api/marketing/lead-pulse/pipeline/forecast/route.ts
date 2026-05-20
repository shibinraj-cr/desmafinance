import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { getPipelineForecast } from "@/lib/lead-pulse-metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/marketing/lead-pulse/pipeline/forecast?year=YYYY&month=MM&userId=...
 *
 * Supervisor view aggregates across all L2 BDEs when userId is omitted.
 * L2 BDEs see only their own row even if they pass another userId.
 */
export async function GET(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  const requestedUserId = url.searchParams.get("userId");
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "invalid_year_or_month" }, { status: 400 });
  }
  const scopedUserId = access.canSupervise ? requestedUserId || undefined : userId;

  const data = await getPipelineForecast(year, month, scopedUserId ? { userId: scopedUserId } : undefined);
  return NextResponse.json(data);
}
