import { parsePeriod, rangeFor, periodLabel, monthLabelFor, singleMonthOf, MONTH_LABELS, type Period } from "./period";
import { todayIst } from "./lead-pulse-dates";
import {
  resolveTeamScope,
  getTeamActivity,
  wholeTeamScope,
  getScorecardExcludedUserIds,
  type TeamActivity,
  type TeamBdeRow,
  type TeamScope,
} from "./crm-team";
import { buildL2Scorecard, type L2Score } from "./crm-score";
import { buildBestPerformers, type BestPerformerEntry } from "./crm-best-performer";
import { getMonthlyTargetByBde } from "./lead-pulse-crm-metrics";
import { getCrmUsageByUser } from "./usage-metrics";
import { activeHours } from "./usage-tracking";
import { MODULES } from "./modules";

/** CRM sub-page href → its sidebar label, for the engagement breakdown. */
const CRM_PAGE_LABEL: Record<string, string> = Object.fromEntries(
  (MODULES.find((m) => m.id === "crm")?.pages ?? []).map((p) => [p.href, p.label]),
);
export function crmPageLabel(href: string): string {
  return CRM_PAGE_LABEL[href] ?? href.replace(/^\/crm\//, "");
}

/** The `period` query value that selects `p` (the web DateFilter's option values). */
export function periodKey(p: Period): string {
  switch (p.kind) {
    case "all":
    case "fy":
    case "custom":
      return p.kind;
    case "month":
      return p.label;
    case "quarter":
      return `q${p.q}`;
    case "half":
      return `h${p.h}`;
  }
}

/**
 * The date filter's presets for the mobile app: months so far (newest first,
 * none in the future), then quarters, halves, the FY and All time — the web
 * DateFilter's list, minus the custom range.
 */
export function activityPeriodOptions(today: string): { value: string; label: string }[] {
  const current = monthLabelFor(today);
  const upTo = current ? MONTH_LABELS.indexOf(current as (typeof MONTH_LABELS)[number]) : MONTH_LABELS.length - 1;
  const months = MONTH_LABELS.slice(0, upTo + 1).reverse();
  return [
    ...months.map((m) => ({ value: m, label: m })),
    ...(["q1", "q2", "q3", "q4", "h1", "h2", "fy", "all"] as const).map((v) => ({
      value: v,
      label: periodLabel(parsePeriod({ period: v })),
    })),
  ];
}

export type EngagementRow = {
  userId: string;
  displayName: string;
  role: string;
  seconds: number;
  /** The three CRM pages with the most active time: [href, seconds]. */
  topPages: [string, number][];
  contacts: number;
  contactsPerHour: number | null;
  tasksCompleted: number;
  enrolledPeriod: number;
};

export type TeamActivityView = {
  scope: TeamScope;
  /** Today in IST, YYYY-MM-DD. */
  today: string;
  /** The month preset the page opens on (or "all" outside the FY presets). */
  defaultPeriod: string;
  period: Period;
  rangeText: string;
  data: TeamActivity;
  engagement: EngagementRow[];
  anyEngagement: boolean;
  scorecard: L2Score[];
  /** Set only when the range is exactly one calendar month (Best Performer is monthly). */
  bestMonth: { year: number; month: number } | null;
  bestPerformers: BestPerformerEntry[] | null;
  /** Consultant rows, worst-first by total attention pressure, then by name. */
  rows: TeamBdeRow[];
};

/**
 * Everything the CRM Activity page (/crm/team) shows, for one viewer, scope and
 * date filter. The web page and the mobile app's GET /api/crm/activity both
 * render this, so their numbers always agree.
 */
export async function loadTeamActivityView(opts: {
  access: Parameters<typeof resolveTeamScope>[0];
  /** "me" forces the personal view for a manager; ignored for a plain BDE. */
  requestedScope?: string;
  period?: string;
  from?: string;
  to?: string;
  now?: Date;
}): Promise<TeamActivityView> {
  const now = opts.now ?? new Date();
  const scope = resolveTeamScope(opts.access, opts.requestedScope);
  // Opens on the current (IST) month, so enrollments, the scorecard and the Best
  // Performer box agree by default; "All time" is an explicit choice.
  const today = todayIst();
  const defaultPeriod = monthLabelFor(today) ?? "all";
  const period = parsePeriod({ period: opts.period ?? defaultPeriod, from: opts.from, to: opts.to });
  const range = rangeFor(period);

  const data = await getTeamActivity({ scope, range, now });

  // Engagement (active time) per consultant over the range — real focused-and-
  // interacting time, not open-tab wall-clock. Joined by userId to the outcome
  // rows so effort sits beside output.
  const crmUsage = await getCrmUsageByUser(
    range,
    data.bdeRows.map((r) => r.userId),
  );
  const engagement = data.bdeRows
    .map((r): EngagementRow => {
      const secs = crmUsage.get(r.userId)?.totalSeconds ?? 0;
      const byPage = crmUsage.get(r.userId)?.byPage ?? {};
      const topPages = Object.entries(byPage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      const hrs = activeHours(secs);
      return {
        userId: r.userId,
        displayName: r.displayName,
        role: r.role,
        seconds: secs,
        topPages,
        contacts: r.contacts,
        contactsPerHour: hrs >= 0.05 ? r.contacts / hrs : null,
        tasksCompleted: r.tasksCompleted,
        enrolledPeriod: r.enrolledPeriod,
      };
    })
    .sort((a, b) => b.seconds - a.seconds || a.displayName.localeCompare(b.displayName));

  // L2 Scorecard — always team-wide (shown to everyone, ranks the whole team), so
  // reuse the viewer's rows when they're already team-wide, else fetch team-wide.
  const scoreRows = scope.teamWide
    ? data.bdeRows
    : (await getTeamActivity({ scope: wholeTeamScope(scope.selfUserId), range, now })).bdeRows;
  const excludedUserIds = await getScorecardExcludedUserIds(scoreRows.map((r) => r.userId));
  const scorecard = buildL2Scorecard(scoreRows, { excludeUserIds: excludedUserIds });

  // Best Performer — a monthly award, so it shows only when the range is exactly
  // one calendar month. It ranks the scorecard's members on the same rows.
  const bestMonth = singleMonthOf(range);
  const bestPerformers = bestMonth
    ? buildBestPerformers(
        scorecard,
        scoreRows,
        await getMonthlyTargetByBde(bestMonth.year, bestMonth.month, scorecard.map((s) => s.userId)),
      )
    : null;

  const pressure = (r: TeamBdeRow) => r.slaBreaches + r.abandoned + r.stuck + r.noTask + r.firstResponseBreached;
  const rows = [...data.bdeRows].sort((a, b) => pressure(b) - pressure(a) || a.displayName.localeCompare(b.displayName));

  return {
    scope,
    today,
    defaultPeriod,
    period,
    rangeText: periodLabel(period),
    data,
    engagement,
    anyEngagement: engagement.some((e) => e.seconds > 0),
    scorecard,
    bestMonth,
    bestPerformers,
    rows,
  };
}
