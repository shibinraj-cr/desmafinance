import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { todayIst } from "@/lib/lead-pulse-dates";
import {
  UNMAPPED_CHANNEL_ID,
  canDecideMarketingBudget,
  canUseMarketingPlanner,
  loadFySnapshot,
  parsePlannerFy,
  plannerFys,
} from "@/lib/mkt-planner";
import { PlannerHeader } from "../_ui";
import { BudgetClient } from "./client";

export const dynamic = "force-dynamic";

export default async function MarketingPlannerBudget({
  searchParams,
}: {
  searchParams: { fy?: string; view?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!canUseMarketingPlanner(perms)) redirect("/");
  const admin = canDecideMarketingBudget(perms);

  const fy = parsePlannerFy(searchParams.fy);
  const today = todayIst();
  const snap = await loadFySnapshot(fy, today);

  const options = snap.campaigns.filter((c) => c.status !== "cancelled" && c.status !== "idea");
  const known = new Set(options.map((c) => c.id));
  const taggedElsewhere = Array.from(
    new Set(snap.ledger.map((r) => r.attr.campaignId).filter((id): id is string => !!id && !known.has(id))),
  );

  const [reallocs, lines, extra] = await Promise.all([
    prisma.mktReallocation.findMany({
      where: { fy },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { fromChannel: { select: { name: true } }, toChannel: { select: { name: true } } },
    }),
    options.length
      ? prisma.mktBudgetLine.findMany({
          where: { campaignId: { in: options.map((c) => c.id) } },
          select: { id: true, campaignId: true, label: true },
          orderBy: [{ seq: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
    taggedElsewhere.length
      ? prisma.mktCampaign.findMany({ where: { id: { in: taggedElsewhere } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const requesterIds = Array.from(new Set(reallocs.map((r) => r.requestedById).filter((id): id is string => !!id)));
  const requesters = requesterIds.length
    ? await prisma.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, username: true } })
    : [];
  const who = new Map(requesters.map((u) => [u.id, u.username]));

  const channelName = Object.fromEntries(snap.channels.map((c) => [c.id, c.name]));
  const campaignName: Record<string, string> = Object.fromEntries([
    ...snap.campaigns.map((c) => [c.id, c.name] as const),
    ...extra.map((c) => [c.id, c.name] as const),
  ]);

  return (
    <main className="max-w-[1400px] mx-auto px-[16px] md:px-[28px] py-[24px] flex flex-col gap-[20px]">
      <PlannerHeader tab="budget" fy={fy} fys={plannerFys()} admin={admin} />
      <BudgetClient
        fy={fy}
        admin={admin}
        nowIdx={snap.progress.ended ? 12 : snap.progress.started ? snap.progress.monthIdx : -1}
        rows={snap.channelRows
          .filter((r) => r.id !== UNMAPPED_CHANNEL_ID)
          .map((r) => ({ id: r.id, name: r.name, monthly: r.monthly, spentMonthly: r.spentMonthly, budget: r.budget, spent: r.spent }))}
        unmapped={snap.channelRows.find((r) => r.id === UNMAPPED_CHANNEL_ID)?.spentMonthly ?? null}
        planMonthly={snap.planMonthly}
        spentMonthly={snap.spentMonthly}
        channels={snap.channels.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
        channelName={channelName}
        campaignName={campaignName}
        campaignOptions={options.map((c) => ({ id: c.id, name: c.name, channelId: c.channelId, startDate: c.startDate }))}
        lines={lines}
        ledger={snap.ledger.map((r) => ({
          id: r.id,
          date: r.date,
          subItem: r.subItem,
          description: r.description,
          partyName: r.partyName,
          paymentMode: r.paymentMode,
          amount: r.amount,
          attr: r.attr,
        }))}
        lineNames={snap.lineNames}
        reallocations={reallocs.map((r) => ({
          id: r.id,
          from: r.fromChannel.name,
          fromMonthIdx: r.fromMonthIdx,
          to: r.toChannel.name,
          toMonthIdx: r.toMonthIdx,
          amount: r.amount,
          reason: r.reason,
          status: r.status,
          requestedBy: r.requestedById ? (who.get(r.requestedById) ?? null) : null,
          createdAt: r.createdAt.toISOString(),
        }))}
        initialView={searchParams.view === "review" ? "review" : "all"}
      />
    </main>
  );
}
