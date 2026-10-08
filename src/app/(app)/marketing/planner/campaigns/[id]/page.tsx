import { notFound, redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { fromPrismaDate, todayIst } from "@/lib/lead-pulse-dates";
import {
  addDaysStr,
  campaignLeadReturn,
  campaignMoney,
  canDecideMarketingBudget,
  canUseMarketingPlanner,
  displayStatus,
  loadAttributedLedger,
  loadChannels,
  type CampaignStatus,
  type CampaignType,
} from "@/lib/mkt-planner";
import { CampaignClient, type PaymentRow } from "./client";

export const dynamic = "force-dynamic";

export default async function MarketingCampaignPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { edit?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!canUseMarketingPlanner(perms)) redirect("/");
  const admin = canDecideMarketingBudget(perms);
  const today = todayIst();

  const c = await prisma.mktCampaign.findUnique({
    where: { id: params.id },
    include: {
      channel: { select: { name: true } },
      owner: { select: { username: true } },
      lines: { orderBy: [{ seq: "asc" }, { createdAt: "asc" }] },
      commitments: { orderBy: { createdAt: "asc" } },
      deliverables: { orderBy: [{ seq: "asc" }, { createdAt: "asc" }], include: { owner: { select: { username: true } } } },
      events: { orderBy: { createdAt: "desc" }, take: 60 },
    },
  });
  if (!c) notFound();

  const startDate = c.startDate ? fromPrismaDate(c.startDate) : null;
  const endDate = c.endDate ? fromPrismaDate(c.endDate) : null;
  const channels = await loadChannels();

  // Payments: rows tagged to this campaign (any date), plus untagged rows the
  // rules attribute to it automatically inside its dates.
  const [tagged, inWindow, linkWindow, leadReturn, users] = await Promise.all([
    prisma.mktSpendTag.findMany({
      where: { campaignId: c.id, transaction: { deletedAt: null } },
      include: {
        transaction: {
          select: { id: true, date: true, subItem: true, description: true, paymentMode: true, amount: true, party: { select: { name: true } } },
        },
      },
    }),
    startDate && (c.status === "approved" || c.status === "done")
      ? loadAttributedLedger(startDate, endDate ?? startDate, channels)
      : Promise.resolve([]),
    // Rows someone might want to link by hand: around the campaign's dates (an
    // advance paid weeks before an event), or the last 90 days for an idea.
    loadAttributedLedger(
      startDate ? addDaysStr(startDate, -90) : addDaysStr(today, -90),
      endDate ? addDaysStr(endDate, 30) : startDate ? addDaysStr(startDate, 30) : today,
      channels,
    ),
    campaignLeadReturn(c.code),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, username: true }, orderBy: { username: "asc" } }),
  ]);

  const payments: PaymentRow[] = [
    ...tagged.map((t) => ({
      transactionId: t.transaction.id,
      date: fromPrismaDate(t.transaction.date),
      subItem: t.transaction.subItem,
      description: t.transaction.description,
      paymentMode: t.transaction.paymentMode,
      partyName: t.transaction.party?.name ?? null,
      amount: Math.round(Number(t.transaction.amount.toString())),
      mode: "tagged" as const,
      lineId: t.lineId,
    })),
    ...inWindow
      .filter((r) => r.attr.mode === "auto" && r.attr.campaignId === c.id)
      .map((r) => ({
        transactionId: r.id,
        date: r.date,
        subItem: r.subItem,
        description: r.description,
        paymentMode: r.paymentMode,
        partyName: r.partyName,
        amount: r.amount,
        mode: "auto" as const,
        lineId: null,
      })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const money = campaignMoney({
    budget: c.budget,
    lines: c.lines,
    commitments: c.commitments,
    payments: payments.map((p) => ({ lineId: p.lineId, amount: p.amount })),
  });

  // Names for the "currently on…" hint in the link dialog.
  const otherIds = Array.from(
    new Set(linkWindow.map((r) => r.attr.campaignId).filter((id): id is string => !!id && id !== c.id)),
  );
  const others = otherIds.length
    ? await prisma.mktCampaign.findMany({ where: { id: { in: otherIds } }, select: { id: true, name: true } })
    : [];
  const otherName = new Map(others.map((o) => [o.id, o.name]));
  const linked = new Set(payments.map((p) => p.transactionId));
  const linkable = linkWindow
    .filter((r) => !linked.has(r.id))
    .slice(0, 150)
    .map((r) => ({
      transactionId: r.id,
      date: r.date,
      subItem: r.subItem,
      description: r.description,
      partyName: r.partyName,
      amount: r.amount,
      currently:
        r.attr.campaignId
          ? `On ${otherName.get(r.attr.campaignId) ?? "another campaign"}`
          : r.attr.mode === "review"
            ? "Needs a campaign"
            : r.attr.mode === "tagged"
              ? "Marked as not a campaign"
              : "Channel spend",
    }));

  const actorIds = Array.from(new Set(c.events.map((e) => e.userId).filter((id): id is string => !!id)));
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, username: true } })
    : [];
  const actorName = new Map(actors.map((a) => [a.id, a.username]));

  const byLine = Object.fromEntries(
    Array.from(money.byLine.entries()).map(([k, v]) => [k ?? "", v]),
  );

  return (
    <CampaignClient
      today={today}
      admin={admin}
      autoEdit={searchParams.edit === "1"}
      channels={channels}
      users={users}
      campaign={{
        id: c.id,
        name: c.name,
        type: c.type as CampaignType,
        status: c.status as CampaignStatus,
        display: displayStatus(c.status, startDate, endDate, today),
        channelId: c.channelId,
        channelName: c.channel?.name ?? null,
        ownerId: c.ownerId,
        ownerName: c.owner?.username ?? null,
        startDate,
        endDate,
        budget: c.budget,
        code: c.code,
        brief: c.brief,
        audience: c.audience,
        services: c.services,
        targetLeads: c.targetLeads,
        targetEnrollments: c.targetEnrollments,
        decisionNote: c.decisionNote,
        canDelete: admin || ["idea", "draft", "cancelled"].includes(c.status),
      }}
      lines={c.lines.map((l) => ({ id: l.id, label: l.label, vendor: l.vendor, planned: l.planned }))}
      commitments={c.commitments.map((m) => ({
        id: m.id,
        lineId: m.lineId,
        amount: m.amount,
        kind: m.kind,
        vendor: m.vendor,
        dueDate: m.dueDate ? fromPrismaDate(m.dueDate) : null,
        note: m.note,
        status: m.status,
      }))}
      deliverables={c.deliverables.map((d) => ({
        id: d.id,
        title: d.title,
        ownerId: d.ownerId,
        ownerName: d.owner?.username ?? null,
        dueDate: d.dueDate ? fromPrismaDate(d.dueDate) : null,
        done: !!d.doneAt,
      }))}
      events={c.events.map((e) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        who: e.userId ? (actorName.get(e.userId) ?? null) : null,
        text: e.text,
      }))}
      payments={payments}
      linkable={linkable}
      money={{
        paid: money.paid,
        committedUnpaid: money.committedUnpaid,
        uncommitted: money.uncommitted,
        over: money.over,
        linesPlanned: money.linesPlanned,
        byLine,
      }}
      leadReturn={leadReturn}
    />
  );
}
