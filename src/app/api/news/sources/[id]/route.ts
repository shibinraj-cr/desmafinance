import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const Schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  topicId: z.string().min(1).optional(),
  kind: z.enum(["rss", "page"]).optional(),
  isActive: z.boolean().optional(),
});

/**
 * PATCH /api/news/sources/[id] — rename, re-file under another topic, change how
 * it is read, or pause it. Admin only.
 *
 * Moving a source to another topic moves its existing items with it, so the feed
 * does not end up with history filed under a topic the link no longer belongs to.
 * The URL is deliberately not editable: it is the dedupe key, and changing it
 * would orphan every item already filed against it. Delete and re-add instead.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!perms.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  const source = await prisma.newsSource.findUnique({
    where: { id: params.id },
    select: { id: true, topicId: true },
  });
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (d.topicId && d.topicId !== source.topicId) {
    const topic = await prisma.newsTopic.findUnique({ where: { id: d.topicId }, select: { id: true } });
    if (!topic) return NextResponse.json({ error: "topic not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.newsSource.update({
      where: { id: params.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.topicId !== undefined ? { topicId: d.topicId } : {}),
        // Switching kind invalidates the stored hash: a feed hash and a
        // page-text hash are not comparable, and keeping the old one would make
        // the next run look "unchanged" and file nothing.
        ...(d.kind !== undefined ? { kind: d.kind, contentHash: null } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
    });
    if (d.topicId !== undefined && d.topicId !== source.topicId) {
      await tx.newsItem.updateMany({ where: { sourceId: params.id }, data: { topicId: d.topicId } });
    }
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/news/sources/[id] — stop polling a link. Admin only.
 *
 * Items it already filed stay in the feed (the schema nulls their sourceId
 * rather than cascading): people have read those updates, and removing a bad
 * link should not rewrite what the feed showed last week.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!perms.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const source = await prisma.newsSource.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.newsSource.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
