import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { blankToNull, logCampaignEvent, requirePlannerApi, rupees } from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  vendor: z.string().trim().max(200).nullable().optional(),
  planned: rupees.optional(),
});

type Ctx = { params: { id: string; lineId: string } };

async function findLine(ctx: Ctx) {
  const line = await prisma.mktBudgetLine.findFirst({
    where: { id: ctx.params.lineId, campaignId: ctx.params.id },
    select: { id: true, label: true },
  });
  if (!line) throw notFound();
  return line;
}

export const PATCH = withApiHandler(async (req: Request, ctx: Ctx) => {
  await requirePlannerApi();
  const data = PatchSchema.parse(await req.json().catch(() => null));
  const line = await findLine(ctx);
  await prisma.mktBudgetLine.update({
    where: { id: line.id },
    data: {
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.vendor !== undefined ? { vendor: blankToNull(data.vendor) ?? null } : {}),
      ...(data.planned !== undefined ? { planned: data.planned } : {}),
    },
  });
  return NextResponse.json({ ok: true });
});

/** Removing a line keeps its commitments and payments on the campaign, just unlined. */
export const DELETE = withApiHandler(async (_req: Request, ctx: Ctx) => {
  const { userId } = await requirePlannerApi();
  const line = await findLine(ctx);
  await prisma.mktBudgetLine.delete({ where: { id: line.id } });
  await logCampaignEvent(ctx.params.id, userId, `Budget line removed: ${line.label}`);
  return NextResponse.json({ ok: true });
});
