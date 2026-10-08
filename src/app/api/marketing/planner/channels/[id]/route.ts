import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { requirePlannerAdmin } from "@/lib/mkt-planner";
import { channelSchema, checkChannelClaims } from "../shared";

export const dynamic = "force-dynamic";

const PatchSchema = channelSchema.partial();

/**
 * PATCH /api/marketing/planner/channels/:id — Admin edits a channel. There is
 * no delete: a channel carries allocations and past spend, so it is switched
 * off (`active: false`) instead, which keeps its history in the totals.
 */
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requirePlannerAdmin();
  const data = PatchSchema.parse(await req.json().catch(() => null));
  const existing = await prisma.mktChannel.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) throw notFound();
  await checkChannelClaims(data, existing.id);
  await prisma.mktChannel.update({
    where: { id: existing.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.ledgerSubItems !== undefined ? { ledgerSubItems: data.ledgerSubItems } : {}),
      ...(data.leadSourceIds !== undefined ? { leadSourceIds: data.leadSourceIds } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
    },
  });
  await recordAudit({ entityType: "MktChannel", entityId: existing.id, action: "UPDATE", userId, changes: data });
  return NextResponse.json({ ok: true });
});
