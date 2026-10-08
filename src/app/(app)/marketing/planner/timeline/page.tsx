import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { todayIst } from "@/lib/lead-pulse-dates";
import {
  canDecideMarketingBudget,
  canUseMarketingPlanner,
  fyProgress,
  loadFySnapshot,
  overlapDays,
  parsePlannerFy,
  plannedInRange,
  plannerFys,
  quarterOfMonth,
  quarterRange,
} from "@/lib/mkt-planner";
import { NewCampaignButton } from "../_campaign-form";
import { PlannerHeader } from "../_ui";
import { TimelineClient } from "./client";

export const dynamic = "force-dynamic";

export default async function MarketingPlannerTimeline({
  searchParams,
}: {
  searchParams: { fy?: string; q?: string; status?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!canUseMarketingPlanner(perms)) redirect("/");
  const admin = canDecideMarketingBudget(perms);

  const fy = parsePlannerFy(searchParams.fy);
  const today = todayIst();
  const progress = fyProgress(fy, today);
  const qParam = Number(searchParams.q);
  const q =
    Number.isInteger(qParam) && qParam >= 0 && qParam <= 3
      ? qParam
      : progress.started && !progress.ended
        ? quarterOfMonth(progress.monthIdx)
        : 0;
  const range = quarterRange(fy, q);
  const fys = plannerFys();

  const [snap, users] = await Promise.all([
    loadFySnapshot(fy, today),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, username: true }, orderBy: { username: "asc" } }),
  ]);

  const inQuarter = snap.campaigns.filter(
    (c) => c.startDate && overlapDays(c.startDate, c.endDate ?? c.startDate, range.start, range.end) > 0,
  );
  const ideas = snap.campaigns.filter((c) => !c.startDate && c.status !== "cancelled");
  // Every request waiting on an Admin, whatever quarter it falls in.
  const awaiting = snap.campaigns
    .filter((c) => c.status === "awaiting")
    .sort((a, b) => ((a.startDate ?? "") < (b.startDate ?? "") ? -1 : 1));
  const allocation = range.months.reduce((a, m) => a + snap.planMonthly[m], 0);
  const planned = plannedInRange(snap.campaigns, range.start, range.end);

  const prev = q > 0 ? { fy, q: q - 1 } : fys.includes(fy - 1) ? { fy: fy - 1, q: 3 } : null;
  const next = q < 3 ? { fy, q: q + 1 } : fys.includes(fy + 1) ? { fy: fy + 1, q: 0 } : null;

  return (
    <main className="max-w-[1400px] mx-auto px-[16px] md:px-[28px] py-[24px] flex flex-col gap-[20px]">
      <PlannerHeader
        tab="timeline"
        fy={fy}
        fys={fys}
        admin={admin}
        actions={<NewCampaignButton channels={snap.channels} users={users} />}
      />
      <TimelineClient
        fy={fy}
        range={range}
        today={today}
        prev={prev}
        next={next}
        campaigns={inQuarter}
        ideas={ideas}
        awaiting={awaiting}
        admin={admin}
        allocation={allocation}
        planned={planned}
        users={users}
        initialStatus={searchParams.status ?? ""}
      />
    </main>
  );
}
