import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { fromPrismaDate } from "@/lib/lead-pulse-dates";
import { MARKETING_CATEGORY, formatInr, logCampaignEvent, requirePlannerApi } from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const PutSchema = z.object({
  transactionId: z.string().min(1),
  // null = reviewed, and deliberately not any campaign's spend.
  campaignId: z.string().min(1).nullable(),
  lineId: z.string().min(1).nullable().optional(),
});

/** The ledger row, provided it is live Marketing expense — the only rows the planner may annotate. */
async function marketingRow(transactionId: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, type: true, category: true, deletedAt: true, amount: true, date: true, subItem: true },
  });
  if (!tx || tx.deletedAt) throw notFound();
  if (tx.type !== "Expense" || tx.category !== MARKETING_CATEGORY) {
    throw badRequest("Only Marketing expense rows can be tagged to a campaign.", "not_marketing");
  }
  return tx;
}

/**
 * PUT /api/marketing/planner/spend-tags — say which campaign (and optionally
 * which budget line) a ledger payment paid for. The ledger row itself is never
 * touched: Finance owns the amount, Marketing only annotates it.
 */
export const PUT = withApiHandler(async (req: Request) => {
  const { userId } = await requirePlannerApi();
  const data = PutSchema.parse(await req.json().catch(() => null));
  const tx = await marketingRow(data.transactionId);

  if (data.campaignId) {
    const c = await prisma.mktCampaign.findUnique({ where: { id: data.campaignId }, select: { id: true } });
    if (!c) throw badRequest("That campaign no longer exists.", "bad_campaign");
    if (data.lineId) {
      const line = await prisma.mktBudgetLine.findFirst({
        where: { id: data.lineId, campaignId: c.id },
        select: { id: true },
      });
      if (!line) throw badRequest("That budget line isn't on this campaign.", "bad_line");
    }
  } else if (data.lineId) {
    throw badRequest("A budget line needs a campaign.", "bad_line");
  }

  const previous = await prisma.mktSpendTag.findUnique({
    where: { transactionId: tx.id },
    select: { campaignId: true },
  });
  await prisma.mktSpendTag.upsert({
    where: { transactionId: tx.id },
    create: { transactionId: tx.id, campaignId: data.campaignId, lineId: data.lineId ?? null, taggedById: userId },
    update: { campaignId: data.campaignId, lineId: data.lineId ?? null, taggedById: userId },
  });

  const amount = Math.round(Number(tx.amount.toString()));
  const what = `${formatInr(amount)} payment of ${fromPrismaDate(tx.date)} (${tx.subItem})`;
  if (data.campaignId && previous?.campaignId !== data.campaignId) {
    await logCampaignEvent(data.campaignId, userId, `${what} tagged to this campaign`);
  }
  if (previous?.campaignId && previous.campaignId !== data.campaignId) {
    await logCampaignEvent(previous.campaignId, userId, `${what} moved off this campaign`);
  }
  await recordAudit({ entityType: "MktSpendTag", entityId: tx.id, action: "UPDATE", userId, changes: data });
  return NextResponse.json({ ok: true });
});

/** DELETE ?transactionId= — drop the tag; the row goes back to automatic attribution or review. */
export const DELETE = withApiHandler(async (req: Request) => {
  const { userId } = await requirePlannerApi();
  const transactionId = new URL(req.url).searchParams.get("transactionId");
  if (!transactionId) throw badRequest("transactionId is required.", "bad_request");
  const tag = await prisma.mktSpendTag.findUnique({ where: { transactionId }, select: { id: true, campaignId: true } });
  if (!tag) return NextResponse.json({ ok: true });
  await prisma.mktSpendTag.delete({ where: { id: tag.id } });
  if (tag.campaignId) await logCampaignEvent(tag.campaignId, userId, "A payment was untagged from this campaign");
  await recordAudit({ entityType: "MktSpendTag", entityId: transactionId, action: "DELETE", userId, changes: {} });
  return NextResponse.json({ ok: true });
});
