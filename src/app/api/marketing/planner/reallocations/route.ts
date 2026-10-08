import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import {
  FY_MONTHS,
  MKT_PLANNER_HREF,
  formatInr,
  notifyPlanner,
  plannerApproverIds,
  requirePlannerApi,
  rupees,
} from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  fy: z.number().int().min(2020).max(2100),
  fromChannelId: z.string().min(1),
  fromMonthIdx: z.number().int().min(0).max(11),
  toChannelId: z.string().min(1),
  toMonthIdx: z.number().int().min(0).max(11),
  amount: rupees.refine((n) => n > 0, "Enter an amount above zero."),
  reason: z.string().trim().max(1000).optional(),
});

/** POST /api/marketing/planner/reallocations — ask an Admin to move budget between channel-months. */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requirePlannerApi();
  const d = BodySchema.parse(await req.json().catch(() => null));
  if (d.fromChannelId === d.toChannelId && d.fromMonthIdx === d.toMonthIdx) {
    throw badRequest("Pick a different destination.", "same_cell");
  }
  const [from, to, source] = await Promise.all([
    prisma.mktChannel.findUnique({ where: { id: d.fromChannelId }, select: { name: true } }),
    prisma.mktChannel.findUnique({ where: { id: d.toChannelId }, select: { name: true } }),
    prisma.mktBudgetAllocation.findUnique({
      where: { channelId_fy_monthIdx: { channelId: d.fromChannelId, fy: d.fy, monthIdx: d.fromMonthIdx } },
      select: { amount: true },
    }),
  ]);
  if (!from || !to) throw badRequest("A channel in this request no longer exists.", "bad_channel");
  const available = source?.amount ?? 0;
  if (d.amount > available) {
    throw badRequest(
      `${from.name} only has ${formatInr(available)} planned in ${FY_MONTHS[d.fromMonthIdx]}.`,
      "insufficient",
    );
  }

  const row = await prisma.mktReallocation.create({
    data: { ...d, reason: d.reason || null, requestedById: userId },
    select: { id: true },
  });
  await notifyPlanner(await plannerApproverIds(), userId, {
    kind: "mkt_realloc_requested",
    title: `Budget move requested: ${formatInr(d.amount)}`,
    body: `${from.name} (${FY_MONTHS[d.fromMonthIdx]}) → ${to.name} (${FY_MONTHS[d.toMonthIdx]})${d.reason ? ` — ${d.reason}` : ""}`,
    linkUrl: `${MKT_PLANNER_HREF}/budget?fy=${d.fy}`,
  });
  await recordAudit({ entityType: "MktReallocation", entityId: row.id, action: "CREATE", userId, changes: d });
  return NextResponse.json({ id: row.id }, { status: 201 });
});
