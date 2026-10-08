import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { requirePlannerAdmin, rupees } from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  fy: z.number().int().min(2020).max(2100),
  cells: z
    .array(
      z.object({
        channelId: z.string().min(1),
        monthIdx: z.number().int().min(0).max(11),
        amount: rupees,
      }),
    )
    .min(1)
    .max(12 * 50),
});

/**
 * PUT /api/marketing/planner/allocations — set channel × month budget cells.
 * Admin only: everyone else moves money with a reallocation request. Admins can
 * edit past months too, because a budget first entered mid-year has to record
 * the plan the months already behind it ran on.
 */
export const PUT = withApiHandler(async (req: Request) => {
  const { userId } = await requirePlannerAdmin();
  const { fy, cells } = BodySchema.parse(await req.json().catch(() => null));

  const channelIds = Array.from(new Set(cells.map((c) => c.channelId)));
  const found = await prisma.mktChannel.count({ where: { id: { in: channelIds } } });
  if (found !== channelIds.length) throw badRequest("A channel in this change no longer exists.", "bad_channel");

  await prisma.$transaction(
    cells.map((c) =>
      prisma.mktBudgetAllocation.upsert({
        where: { channelId_fy_monthIdx: { channelId: c.channelId, fy, monthIdx: c.monthIdx } },
        create: { channelId: c.channelId, fy, monthIdx: c.monthIdx, amount: c.amount, updatedById: userId },
        update: { amount: c.amount, updatedById: userId },
      }),
    ),
  );
  await recordAudit({
    entityType: "MktBudgetAllocation",
    entityId: `fy${fy}`,
    action: "UPDATE",
    userId,
    changes: { cells },
  });
  return NextResponse.json({ ok: true });
});
