import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import {
  blankToNull,
  campaignFieldsSchema,
  checkCampaignRefs,
  formatInr,
  logCampaignEvent,
  requirePlannerApi,
} from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

/**
 * POST /api/marketing/planner/campaigns — any planner user can create. With no
 * dates it is an unscheduled idea; with dates, a draft. Approval is a separate
 * step (POST …/status), never a create flag.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requirePlannerApi();
  const data = campaignFieldsSchema.parse(await req.json().catch(() => null));
  const startDate = data.startDate ?? null;
  const endDate = data.endDate ?? null;
  await checkCampaignRefs({ startDate, endDate }, data);

  const status = startDate ? "draft" : "idea";
  const campaign = await prisma.mktCampaign.create({
    data: {
      name: data.name,
      type: data.type,
      status,
      channelId: data.channelId ?? null,
      ownerId: data.ownerId ?? userId,
      startDate: startDate ? toPrismaDate(startDate) : null,
      endDate: endDate ? toPrismaDate(endDate) : null,
      budget: data.budget ?? 0,
      code: blankToNull(data.code) ?? null,
      brief: blankToNull(data.brief) ?? null,
      audience: blankToNull(data.audience) ?? null,
      services: blankToNull(data.services) ?? null,
      targetLeads: data.targetLeads ?? null,
      targetEnrollments: data.targetEnrollments ?? null,
      createdById: userId,
    },
    select: { id: true, name: true, budget: true },
  });

  await logCampaignEvent(
    campaign.id,
    userId,
    status === "idea" ? "Added as an unscheduled idea" : `Created as a draft at ${formatInr(campaign.budget)}`,
  );
  await recordAudit({
    entityType: "MktCampaign",
    entityId: campaign.id,
    action: "CREATE",
    userId,
    changes: { name: campaign.name, budget: campaign.budget, status },
  });
  return NextResponse.json({ id: campaign.id }, { status: 201 });
});
