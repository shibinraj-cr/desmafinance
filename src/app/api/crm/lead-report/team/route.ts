import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { resolveReportDay } from "@/lib/crm-daily-report";
import { getLeadReportAccess, getTeamLeadReport } from "@/lib/crm-lead-report-data";

export const dynamic = "force-dynamic";

/**
 * Every active BDE's daily lead report for one IST day, with team totals (the
 * sum of the rows), the missed-lead list and handovers needing action.
 * CRM managers and the Marketing Admin.
 */
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getLeadReportAccess(userId, perms);
  if (!access.canViewOthers) throw forbidden();
  const day = resolveReportDay(new URL(req.url).searchParams.get("date") ?? undefined);
  return NextResponse.json({ ...(await getTeamLeadReport(day)), canUnlock: access.canUnlock });
});
