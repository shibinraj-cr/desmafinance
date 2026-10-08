import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { forbidden, notFound } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { fromPrismaDate, toPrismaDate } from "@/lib/lead-pulse-dates";
import {
  MKT_PLANNER_HREF,
  blankToNull,
  campaignFieldsSchema,
  checkCampaignRefs,
  formatInr,
  logCampaignEvent,
  notifyPlanner,
  plannerApproverIds,
  requirePlannerApi,
} from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const PatchSchema = campaignFieldsSchema.partial();

/**
 * PATCH /api/marketing/planner/campaigns/:id — edit fields. Status moves go
 * through …/status. A non-admin changing the money (budget, channel or dates)
 * of an approved campaign sends it back for approval: the approval was for the
 * old figures.
 */
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, admin } = await requirePlannerApi();
  const data = PatchSchema.parse(await req.json().catch(() => null));

  const existing = await prisma.mktCampaign.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  const curStart = existing.startDate ? fromPrismaDate(existing.startDate) : null;
  const curEnd = existing.endDate ? fromPrismaDate(existing.endDate) : null;
  const startDate = data.startDate !== undefined ? data.startDate : curStart;
  const endDate = data.endDate !== undefined ? data.endDate : curEnd;
  await checkCampaignRefs({ startDate, endDate }, data, existing.id);

  const budgetChanged = data.budget !== undefined && data.budget !== existing.budget;
  const channelChanged = data.channelId !== undefined && data.channelId !== existing.channelId;
  const datesChanged = startDate !== curStart || endDate !== curEnd;
  const moneyChanged = budgetChanged || channelChanged || datesChanged;

  let status = existing.status;
  let backToApproval = false;
  if (!admin && existing.status === "approved" && moneyChanged) {
    status = "awaiting";
    backToApproval = true;
  } else if (existing.status === "idea" && startDate) {
    status = "draft";
  } else if (existing.status === "draft" && !startDate) {
    status = "idea";
  }

  await prisma.mktCampaign.update({
    where: { id: existing.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.channelId !== undefined ? { channelId: data.channelId } : {}),
      ...(data.ownerId !== undefined ? { ownerId: data.ownerId } : {}),
      ...(data.startDate !== undefined ? { startDate: startDate ? toPrismaDate(startDate) : null } : {}),
      ...(data.endDate !== undefined ? { endDate: endDate ? toPrismaDate(endDate) : null } : {}),
      ...(data.budget !== undefined ? { budget: data.budget } : {}),
      ...(data.code !== undefined ? { code: blankToNull(data.code) ?? null } : {}),
      ...(data.brief !== undefined ? { brief: blankToNull(data.brief) ?? null } : {}),
      ...(data.audience !== undefined ? { audience: blankToNull(data.audience) ?? null } : {}),
      ...(data.services !== undefined ? { services: blankToNull(data.services) ?? null } : {}),
      ...(data.targetLeads !== undefined ? { targetLeads: data.targetLeads } : {}),
      ...(data.targetEnrollments !== undefined ? { targetEnrollments: data.targetEnrollments } : {}),
      status,
      ...(backToApproval ? { submittedAt: new Date() } : {}),
    },
  });

  if (budgetChanged) {
    await logCampaignEvent(existing.id, userId, `Budget changed ${formatInr(existing.budget)} → ${formatInr(data.budget!)}`);
  }
  if (datesChanged) {
    await logCampaignEvent(existing.id, userId, `Dates changed to ${startDate ?? "unscheduled"}${endDate ? ` – ${endDate}` : ""}`);
  }
  if (backToApproval) {
    await logCampaignEvent(existing.id, userId, "Changed after approval — sent back for approval");
    await notifyPlanner(await plannerApproverIds(), userId, {
      kind: "mkt_campaign_submitted",
      title: `Campaign changed after approval: ${data.name ?? existing.name}`,
      body: `Budget, channel or dates changed — it needs approving again (${formatInr(data.budget ?? existing.budget)}).`,
      linkUrl: `${MKT_PLANNER_HREF}/campaigns/${existing.id}`,
    });
  }

  await recordAudit({ entityType: "MktCampaign", entityId: existing.id, action: "UPDATE", userId, changes: data });
  return NextResponse.json({ ok: true, status });
});

/**
 * DELETE — only while nothing has been decided on it (idea, draft, cancelled),
 * unless an Admin does it. Its spend tags go with it, so any payment tagged to
 * it returns to automatic attribution or the review queue.
 */
export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, admin } = await requirePlannerApi();
  const existing = await prisma.mktCampaign.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, status: true, budget: true },
  });
  if (!existing) throw notFound();
  if (!admin && !["idea", "draft", "cancelled"].includes(existing.status)) {
    throw forbidden("Cancel it first — only ideas, drafts and cancelled campaigns can be deleted.");
  }
  await prisma.mktCampaign.delete({ where: { id: existing.id } });
  await recordAudit({
    entityType: "MktCampaign",
    entityId: existing.id,
    action: "DELETE",
    userId,
    changes: { name: existing.name, status: existing.status, budget: existing.budget },
  });
  return NextResponse.json({ ok: true });
});
