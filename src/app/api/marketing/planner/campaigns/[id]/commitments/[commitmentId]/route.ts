import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { formatInr, logCampaignEvent, requirePlannerApi } from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({ status: z.enum(["open", "cancelled"]) });

/** PATCH — cancel a commitment that fell through (or restore one cancelled by mistake). */
export const PATCH = withApiHandler(
  async (req: Request, { params }: { params: { id: string; commitmentId: string } }) => {
    const { userId } = await requirePlannerApi();
    const { status } = PatchSchema.parse(await req.json().catch(() => null));
    const row = await prisma.mktCommitment.findFirst({
      where: { id: params.commitmentId, campaignId: params.id },
      select: { id: true, amount: true, status: true },
    });
    if (!row) throw notFound();
    if (row.status !== status) {
      await prisma.mktCommitment.update({ where: { id: row.id }, data: { status } });
      await logCampaignEvent(
        params.id,
        userId,
        status === "cancelled" ? `${formatInr(row.amount)} commitment cancelled` : `${formatInr(row.amount)} commitment restored`,
      );
    }
    return NextResponse.json({ ok: true });
  },
);
