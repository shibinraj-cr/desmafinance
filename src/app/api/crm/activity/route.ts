import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { SLA_THRESHOLD_DAYS, ABANDONED_DAYS, STUCK_DAYS } from "@/lib/crm-team";
import { BEST_PERFORMER_WEIGHTS } from "@/lib/crm-best-performer";
import { QUALITY_DUE_AFTER_DAYS } from "@/lib/crm-lead-quality";
import { formatActiveTime } from "@/lib/usage-tracking";
import { loadTeamActivityView, crmPageLabel, periodKey, activityPeriodOptions } from "@/lib/crm-team-view";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/activity?scope=me&period=Nov-26 — the CRM Activity page
 * (/crm/team) as JSON, for the mobile app. Same loader as the page, so the
 * numbers match: a plain BDE gets their own numbers, a manager the whole team
 * (or `scope=me`). The L2 Scorecard and Best Performer always rank the team.
 */
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const sp = new URL(req.url).searchParams;
  const v = await loadTeamActivityView({
    access,
    requestedScope: sp.get("scope") ?? undefined,
    period: sp.get("period") || undefined,
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
  });

  let bestPerformer = null;
  if (v.bestMonth && v.bestPerformers) {
    const { year, month } = v.bestMonth;
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const inProgress = v.today.slice(0, 7) === ym;
    bestPerformer = {
      monthLabel: new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      inProgress,
      isPast: v.today.slice(0, 7) > ym,
      daysLeft: inProgress ? new Date(Date.UTC(year, month, 0)).getUTCDate() - Number(v.today.slice(8, 10)) : 0,
      weights: BEST_PERFORMER_WEIGHTS,
      entries: v.bestPerformers,
    };
  }

  return NextResponse.json({
    scope: { teamWide: v.scope.teamWide, canViewWholeTeam: v.scope.canViewWholeTeam },
    period: periodKey(v.period),
    rangeText: v.rangeText,
    periodOptions: activityPeriodOptions(v.today),
    thresholds: {
      slaDays: [...new Set(Object.values(SLA_THRESHOLD_DAYS))].sort((a, b) => a - b),
      abandonedDays: ABANDONED_DAYS,
      stuckDays: STUCK_DAYS,
      qualityDueAfterDays: QUALITY_DUE_AFTER_DAYS,
    },
    totals: v.data.totals,
    newLeadTrend: v.data.newLeadTrend,
    bestPerformer,
    scorecard: v.scorecard,
    engagement: v.anyEngagement
      ? v.engagement.map((e) => ({
          ...e,
          activeTime: formatActiveTime(e.seconds),
          topPages: e.topPages.map(([href, secs]) => ({ label: crmPageLabel(href), time: formatActiveTime(secs) })),
        }))
      : [],
    rows: v.rows,
    attention: v.data.attention,
  });
});
