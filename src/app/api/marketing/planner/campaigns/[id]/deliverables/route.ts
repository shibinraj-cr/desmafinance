import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import { DATE_RX, requirePlannerApi } from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  ownerId: z.string().min(1).nullable().optional(),
  dueDate: z.string().regex(DATE_RX).nullable().optional(),
});

/** POST /api/marketing/planner/campaigns/:id/deliverables — add a checklist item. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requirePlannerApi();
  const data = CreateSchema.parse(await req.json().catch(() => null));
  const campaign = await prisma.mktCampaign.findUnique({ where: { id: params.id }, select: { id: true, ownerId: true } });
  if (!campaign) throw notFound();
  if (data.ownerId) {
    const u = await prisma.user.findUnique({ where: { id: data.ownerId }, select: { isActive: true } });
    if (!u?.isActive) throw badRequest("The selected owner is not an active user.", "bad_owner");
  }
  const last = await prisma.mktDeliverable.findFirst({
    where: { campaignId: campaign.id },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const row = await prisma.mktDeliverable.create({
    data: {
      campaignId: campaign.id,
      title: data.title,
      ownerId: data.ownerId ?? campaign.ownerId,
      dueDate: data.dueDate ? toPrismaDate(data.dueDate) : null,
      seq: (last?.seq ?? -1) + 1,
    },
    select: { id: true },
  });
  return NextResponse.json({ id: row.id }, { status: 201 });
});
