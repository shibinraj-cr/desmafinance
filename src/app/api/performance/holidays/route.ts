import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { badRequest, forbidden, unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canViewAnyTeamPerformancePage } from "@/lib/team-performance-rbac";
import { isValidIngestToken } from "@/lib/team-performance-ingest";
import { getHolidayMap } from "@/lib/team-performance";

export const dynamic = "force-dynamic";

// GET /api/performance/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD
// Desgro HR holiday calendar for the scoring routine (Sundays are implied).
export const GET = withApiHandler(async (req: Request) => {
  if (!isValidIngestToken(req)) {
    const { userId, perms } = await getCurrentUserAndPermissions();
    if (!userId || !perms) throw unauthorized();
    if (!canViewAnyTeamPerformancePage(perms)) throw forbidden();
  }
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest("from and to must be YYYY-MM-DD");
  const map = await getHolidayMap(from, to);
  return NextResponse.json({ holidays: [...map].map(([date, label]) => ({ date, label })) });
});
