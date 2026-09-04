import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isFetchableUrl, syncSource } from "@/lib/news/sync";

const Schema = z.object({
  topicId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(2000),
  kind: z.enum(["rss", "page"]).default("rss"),
});

/**
 * POST /api/news/sources — register a link under a topic. Admin only.
 *
 * The new source is pulled once, synchronously, so the admin finds out here
 * whether the link actually works instead of discovering tomorrow that the cron
 * has been failing on it. The pull result is returned with the response.
 */
export async function POST(req: Request) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!perms.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  if (!isFetchableUrl(d.url)) {
    return NextResponse.json(
      { error: "That URL must be a public http:// or https:// address." },
      { status: 400 },
    );
  }

  const topic = await prisma.newsTopic.findUnique({ where: { id: d.topicId }, select: { id: true } });
  if (!topic) return NextResponse.json({ error: "topic not found" }, { status: 404 });

  let source;
  try {
    source = await prisma.newsSource.create({
      data: { topicId: d.topicId, name: d.name, url: d.url, kind: d.kind, createdById: userId },
    });
  } catch (e) {
    // The URL is unique across all topics — the same link filed twice would
    // publish every update twice.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "That link is already registered." }, { status: 409 });
    }
    throw e;
  }

  const result = await syncSource({
    id: source.id,
    topicId: source.topicId,
    name: source.name,
    url: source.url,
    kind: source.kind,
    contentHash: source.contentHash,
    lastFetchedAt: source.lastFetchedAt,
  });

  return NextResponse.json({ ok: true, source: { id: source.id }, result });
}
