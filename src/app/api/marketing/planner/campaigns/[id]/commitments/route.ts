import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import {
  COMMITMENT_KINDS,
  COMMITMENT_KIND_LABELS,
  DATE_RX,
  blankToNull,
  formatInr,
  logCampaignEvent,
  requirePlannerApi,
  rupees,
} from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const CommitSchema = z.object({
  lineId: z.string().min(1).nullable().optional(),
  amount: rupees.refine((n) => n > 0, "Enter an amount above zero."),
  kind: z.enum(COMMITMENT_KINDS),
  vendor: z.string().trim().max(200).nullable().optional(),
  dueDate: z.string().regex(DATE_RX).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

/**
 * POST /api/marketing/planner/campaigns/:id/commitments — log money promised
 * but not yet paid. It nets off on its own as the ledger shows payments against
 * the same line, so there is no "mark paid" step.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requirePlannerApi();
  const data = CommitSchema.parse(await req.json().catch(() => null));
  const campaign = await prisma.mktCampaign.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
  if (!campaign) throw notFound();
  if (campaign.status === "cancelled") throw badRequest("This campaign is cancelled.", "cancelled");
  if (data.lineId) {
    const line = await prisma.mktBudgetLine.findFirst({ where: { id: data.lineId, campaignId: campaign.id }, select: { id: true } });
    if (!line) throw badRequest("That budget line isn't on this campaign.", "bad_line");
  }
  const row = await prisma.mktCommitment.create({
    data: {
      campaignId: campaign.id,
      lineId: data.lineId ?? null,
      amount: data.amount,
      kind: data.kind,
      vendor: blankToNull(data.vendor) ?? null,
      dueDate: data.dueDate ? toPrismaDate(data.dueDate) : null,
      note: blankToNull(data.note) ?? null,
      createdById: userId,
    },
    select: { id: true },
  });
  await logCampaignEvent(
    campaign.id,
    userId,
    `${formatInr(data.amount)} committed — ${COMMITMENT_KIND_LABELS[data.kind].toLowerCase()}${data.vendor ? `, ${data.vendor}` : ""}`,
  );
  return NextResponse.json({ id: row.id }, { status: 201 });
});
