import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { markItemRead } from "@/lib/news/read";

/**
 * POST /api/news/items/[id]/read — record that the signed-in user has read one
 * update. Every authenticated user may call this: the feed is a broadcast, and
 * the receipt is about them, not about the item.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const item = await prisma.newsItem.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  await markItemRead(userId, item.id);
  return NextResponse.json({ ok: true });
}
