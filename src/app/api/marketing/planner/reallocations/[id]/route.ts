import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { FY_MONTHS, MKT_PLANNER_HREF, formatInr, notifyPlanner, requirePlannerAdmin } from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ decision: z.enum(["approve", "reject"]) });

/**
 * POST /api/marketing/planner/reallocations/:id — an Admin decides. Approval
 * moves the money in the allocation grid inside one transaction, re-checking
 * that the source cell still holds enough (it may have been edited since the
 * request was made).
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requirePlannerAdmin();
  const { decision } = BodySchema.parse(await req.json().catch(() => null));

  const r = await prisma.mktReallocation.findUnique({
    where: { id: params.id },
    include: { fromChannel: { select: { name: true } }, toChannel: { select: { name: true } } },
  });
  if (!r) throw notFound();
  if (r.status !== "pending") throw badRequest("This request has already been decided.", "decided");

  if (decision === "approve") {
    await prisma.$transaction(async (tx) => {
      const source = await tx.mktBudgetAllocation.findUnique({
        where: { channelId_fy_monthIdx: { channelId: r.fromChannelId, fy: r.fy, monthIdx: r.fromMonthIdx } },
      });
      if (!source || source.amount < r.amount) {
        throw badRequest(
          `${r.fromChannel.name} no longer has ${formatInr(r.amount)} planned in ${FY_MONTHS[r.fromMonthIdx]}.`,
          "insufficient",
        );
      }
      await tx.mktBudgetAllocation.update({
        where: { id: source.id },
        data: { amount: source.amount - r.amount, updatedById: userId },
      });
      await tx.mktBudgetAllocation.upsert({
        where: { channelId_fy_monthIdx: { channelId: r.toChannelId, fy: r.fy, monthIdx: r.toMonthIdx } },
        create: { channelId: r.toChannelId, fy: r.fy, monthIdx: r.toMonthIdx, amount: r.amount, updatedById: userId },
        update: { amount: { increment: r.amount }, updatedById: userId },
      });
      await tx.mktReallocation.update({
        where: { id: r.id },
        data: { status: "approved", decidedById: userId, decidedAt: new Date() },
      });
    });
  } else {
    await prisma.mktReallocation.update({
      where: { id: r.id },
      data: { status: "rejected", decidedById: userId, decidedAt: new Date() },
    });
  }

  await notifyPlanner([r.requestedById], userId, {
    kind: "mkt_realloc_decided",
    title: `Budget move ${decision === "approve" ? "approved" : "rejected"}: ${formatInr(r.amount)}`,
    body: `${r.fromChannel.name} (${FY_MONTHS[r.fromMonthIdx]}) → ${r.toChannel.name} (${FY_MONTHS[r.toMonthIdx]})`,
    linkUrl: `${MKT_PLANNER_HREF}/budget?fy=${r.fy}`,
  });
  await recordAudit({
    entityType: "MktReallocation",
    entityId: r.id,
    action: "UPDATE",
    userId,
    changes: { status: decision === "approve" ? "approved" : "rejected" },
  });
  return NextResponse.json({ ok: true });
});
