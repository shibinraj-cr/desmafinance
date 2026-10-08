import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  MARKETING_CATEGORY,
  MKT_PLANNER_HREF,
  canDecideMarketingBudget,
  canUseMarketingPlanner,
  loadChannels,
  parsePlannerFy,
  plannerFys,
} from "@/lib/mkt-planner";
import { PlannerHeader } from "../_ui";
import { ChannelsClient } from "./client";

export const dynamic = "force-dynamic";

/** Admin-only: which ledger sub-items and CRM lead sources feed each channel. */
export default async function MarketingPlannerChannels({ searchParams }: { searchParams: { fy?: string } }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!canUseMarketingPlanner(perms)) redirect("/");
  if (!canDecideMarketingBudget(perms)) redirect(MKT_PLANNER_HREF);
  const fy = parsePlannerFy(searchParams.fy);

  const [channels, categories, sources] = await Promise.all([
    loadChannels(),
    prisma.category.findMany({
      where: { name: MARKETING_CATEGORY, type: { in: ["Expense", "Both"] } },
      include: { subItems: { select: { name: true, isActive: true }, orderBy: { name: "asc" } } },
    }),
    prisma.leadPulseSource.findMany({ select: { id: true, label: true, active: true }, orderBy: [{ displayOrder: "asc" }, { label: "asc" }] }),
  ]);
  const subItems = Array.from(
    new Map(categories.flatMap((c) => c.subItems).map((s) => [s.name, s])).values(),
  ).map((s) => ({ name: s.name, active: s.isActive }));

  return (
    <main className="max-w-[1400px] mx-auto px-[16px] md:px-[28px] py-[24px] flex flex-col gap-[20px]">
      <PlannerHeader
        tab="channels"
        fy={fy}
        fys={plannerFys()}
        admin
        subtitle="Which finance ledger sub-items count as each channel's spend, and which CRM lead sources count as its return."
      />
      <ChannelsClient channels={channels} subItems={subItems} sources={sources} />
    </main>
  );
}
