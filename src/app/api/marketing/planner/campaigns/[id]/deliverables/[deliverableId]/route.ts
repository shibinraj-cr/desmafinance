import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import { DATE_RX, logCampaignEvent, requirePlannerApi } from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  dueDate: z.string().regex(DATE_RX).nullable().optional(),
  done: z.boolean().optional(),
});

type Ctx = { params: { id: string; deliverableId: string } };

async function findRow(ctx: Ctx) {
  const row = await prisma.mktDeliverable.findFirst({
    where: { id: ctx.params.deliverableId, campaignId: ctx.params.id },
    select: { id: true, title: true, doneAt: true },
  });
  if (!row) throw notFound();
  return row;
}

export const PATCH = withApiHandler(async (req: Request, ctx: Ctx) => {
  const { userId } = await requirePlannerApi();
  const data = PatchSchema.parse(await req.json().catch(() => null));
  const row = await findRow(ctx);
  if (data.ownerId) {
    const u = await prisma.user.findUnique({ where: { id: data.ownerId }, select: { isActive: true } });
    if (!u?.isActive) throw badRequest("The selected owner is not an active user.", "bad_owner");
  }
  await prisma.mktDeliverable.update({
    where: { id: row.id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.ownerId !== undefined ? { ownerId: data.ownerId } : {}),
      // A new due date re-arms the reminder for that day.
      ...(data.dueDate !== undefined
        ? { dueDate: data.dueDate ? toPrismaDate(data.dueDate) : null, remindedOn: null }
        : {}),
      ...(data.done !== undefined ? { doneAt: data.done ? (row.doneAt ?? new Date()) : null } : {}),
    },
  });
  if (data.done === true && !row.doneAt) {
    await logCampaignEvent(ctx.params.id, userId, `Deliverable done: ${row.title}`);
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiHandler(async (_req: Request, ctx: Ctx) => {
  await requirePlannerApi();
  const row = await findRow(ctx);
  await prisma.mktDeliverable.delete({ where: { id: row.id } });
  return NextResponse.json({ ok: true });
});
