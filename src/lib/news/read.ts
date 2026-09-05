import { prisma } from "@/lib/prisma";
import { NEWS_WINDOW_DAYS } from "@/lib/news/constants";

export function newsWindowStart(now = new Date()): Date {
  return new Date(now.getTime() - NEWS_WINDOW_DAYS * 86_400_000);
}

/**
 * The signed-in user's unread count, for the nav badge. Best-effort: a failure
 * here must not take down the app shell that renders on every page, so it
 * degrades to 0 (no badge) rather than throwing.
 */
export async function countUnreadNews(userId: string, now = new Date()): Promise<number> {
  return prisma.newsItem
    .count({
      where: {
        publishedAt: { gte: newsWindowStart(now) },
        topic: { isActive: true },
        reads: { none: { userId } },
      },
    })
    .catch(() => 0);
}

/** Per-topic unread counts, keyed by topic id. Drives the dots on the topic chips. */
export async function unreadByTopic(
  userId: string,
  now = new Date(),
): Promise<Record<string, number>> {
  const rows = await prisma.newsItem
    .groupBy({
      by: ["topicId"],
      where: {
        publishedAt: { gte: newsWindowStart(now) },
        topic: { isActive: true },
        reads: { none: { userId } },
      },
      _count: { _all: true },
    })
    .catch(() => [] as { topicId: string; _count: { _all: number } }[]);
  return Object.fromEntries(rows.map((r) => [r.topicId, r._count._all]));
}

export type FeedItem = {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string;
  isPinned: boolean;
  isRead: boolean;
  topicId: string;
  topicName: string;
  topicSlug: string;
  topicColor: string;
  topicIcon: string;
  sourceName: string | null;
};

/**
 * The feed one user sees, newest first, pinned items above the rest.
 *
 * `topicSlug` filters to a single topic; `unreadOnly` narrows to what they have
 * not opened. Read state is resolved with a single scoped include rather than a
 * second query, so the list stays one round trip.
 */
export async function getFeed(opts: {
  userId: string;
  topicSlug?: string | null;
  unreadOnly?: boolean;
  take?: number;
  now?: Date;
}): Promise<FeedItem[]> {
  const now = opts.now ?? new Date();
  const rows = await prisma.newsItem.findMany({
    where: {
      publishedAt: { gte: newsWindowStart(now) },
      topic: { isActive: true, ...(opts.topicSlug ? { slug: opts.topicSlug } : {}) },
      ...(opts.unreadOnly ? { reads: { none: { userId: opts.userId } } } : {}),
    },
    orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }],
    take: opts.take ?? 100,
    include: {
      topic: { select: { id: true, name: true, slug: true, color: true, icon: true } },
      source: { select: { name: true } },
      // Scoped to this user, so `reads[0]` is their receipt or nothing at all.
      reads: { where: { userId: opts.userId }, select: { id: true }, take: 1 },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    url: r.url,
    publishedAt: r.publishedAt.toISOString(),
    isPinned: r.isPinned,
    isRead: r.reads.length > 0,
    topicId: r.topic.id,
    topicName: r.topic.name,
    topicSlug: r.topic.slug,
    topicColor: r.topic.color,
    topicIcon: r.topic.icon,
    sourceName: r.source?.name ?? null,
  }));
}

/** Record that a user has read one item. Idempotent — re-reading is a no-op. */
export async function markItemRead(userId: string, itemId: string): Promise<void> {
  await prisma.newsItemRead
    .create({ data: { userId, itemId } })
    .catch(() => {
      // Unique violation = already read. Any other failure is a read receipt we
      // can live without; it must not fail the click that triggered it.
    });
}

/**
 * Mark everything currently in the user's window read (optionally one topic).
 *
 * Bounded by the same window as the feed, so this writes at most one row per
 * item the user could actually see — not one per item ever published.
 */
export async function markAllRead(
  userId: string,
  topicSlug?: string | null,
  now = new Date(),
): Promise<number> {
  const items = await prisma.newsItem.findMany({
    where: {
      publishedAt: { gte: newsWindowStart(now) },
      topic: { isActive: true, ...(topicSlug ? { slug: topicSlug } : {}) },
      reads: { none: { userId } },
    },
    select: { id: true },
  });
  if (items.length === 0) return 0;
  const res = await prisma.newsItemRead.createMany({
    data: items.map((i) => ({ userId, itemId: i.id })),
    skipDuplicates: true,
  });
  return res.count;
}

/** URL-safe slug from a topic name. Falls back so a name of only punctuation still yields a key. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "topic";
}
