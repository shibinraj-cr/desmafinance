import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { blankToNull, formatInr, logCampaignEvent, requirePlannerApi, rupees } from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const LineSchema = z.object({
  label: z.string().trim().min(1).max(200),
  vendor: z.string().trim().max(200).nullable().optional(),
  planned: rupees,
});

/** POST /api/marketing/planner/campaigns/:id/lines — add a budget line. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requirePlannerApi();
  const data = LineSchema.parse(await req.json().catch(() => null));
  const campaign = await prisma.mktCampaign.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!campaign) throw notFound();

  const last = await prisma.mktBudgetLine.findFirst({
    where: { campaignId: campaign.id },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const line = await prisma.mktBudgetLine.create({
    data: {
      campaignId: campaign.id,
      label: data.label,
      vendor: blankToNull(data.vendor) ?? null,
      planned: data.planned,
      seq: (last?.seq ?? -1) + 1,
    },
    select: { id: true },
  });
  await logCampaignEvent(campaign.id, userId, `Budget line added: ${data.label} (${formatInr(data.planned)})`);
  return NextResponse.json({ id: line.id }, { status: 201 });
});
