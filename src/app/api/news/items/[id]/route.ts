import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const Schema = z.object({ isPinned: z.boolean() });

/**
 * PATCH /api/news/items/[id] — pin or unpin one update. Admin only.
 * A pinned item sorts above everything else in the feed.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!perms.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }

  const item = await prisma.newsItem.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.newsItem.update({ where: { id: params.id }, data: { isPinned: parsed.data.isPinned } });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/news/items/[id] — pull one update out of the feed. Admin only.
 *
 * Sources are external, so some of what they publish will be noise, an error, or
 * simply not for this audience. Without this the only remedy would be to remove
 * the whole link. The item's guid goes with it, so a later run of the same feed
 * can re-file the entry; that is the trade for keeping deletion simple, and it
 * only matters if the entry is still in the feed.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!perms.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const item = await prisma.newsItem.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.newsItem.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
