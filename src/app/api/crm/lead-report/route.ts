import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { resolveReportDay } from "@/lib/crm-daily-report";
import { bdeName, getLeadReportAccess, getLeadReportView } from "@/lib/crm-lead-report-data";

export const dynamic = "force-dynamic";

/**
 * One BDE's daily lead report (My Day on web and the app). `?bde=` is for
 * managers and the Marketing Admin; a BDE always gets their own. `?date=` is
 * an IST day (default today, never the future).
 */
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getLeadReportAccess(userId, perms);
  const sp = new URL(req.url).searchParams;
  const requested = sp.get("bde")?.trim() || userId;
  if (requested !== userId && !access.canViewOthers) throw forbidden();
  if (requested === userId && !access.crm.isBde && !access.canViewOthers) throw forbidden("not_a_bde");

  const name = requested === userId ? (access.crm.bdeDisplayName ?? (await bdeName(userId))) : await bdeName(requested);
  if (!name) throw notFound();
  const view = await getLeadReportView({ userId: requested, name, day: resolveReportDay(sp.get("date") ?? undefined) });
  return NextResponse.json({
    ...view,
    isOwner: requested === userId,
    // For the app, which has no role flags of its own: show My Day's report
    // only to BDEs, the team view and BDE picker only to managers.
    isBde: access.crm.isBde,
    canViewOthers: access.canViewOthers,
    canUnlock: access.canUnlock,
  });
});
