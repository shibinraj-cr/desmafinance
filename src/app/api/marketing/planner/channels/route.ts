import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { requirePlannerAdmin } from "@/lib/mkt-planner";
import { channelSchema, checkChannelClaims } from "./shared";

export const dynamic = "force-dynamic";

/** POST /api/marketing/planner/channels — Admin adds a spend channel. */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requirePlannerAdmin();
  const data = channelSchema.parse(await req.json().catch(() => null));
  await checkChannelClaims(data);
  const last = await prisma.mktChannel.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const row = await prisma.mktChannel.create({
    data: {
      name: data.name,
      ledgerSubItems: data.ledgerSubItems ?? [],
      leadSourceIds: data.leadSourceIds ?? [],
      active: data.active ?? true,
      sortOrder: data.sortOrder ?? (last?.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  });
  await recordAudit({ entityType: "MktChannel", entityId: row.id, action: "CREATE", userId, changes: data });
  return NextResponse.json({ id: row.id }, { status: 201 });
});
