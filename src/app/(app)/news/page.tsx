import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { getFeed, unreadByTopic } from "@/lib/news/read";
import { NewsFeedClient, type TopicChip } from "./client";

export const dynamic = "force-dynamic";

/**
 * /news — the company feed. Open to every signed-in user (see
 * ALWAYS_VISIBLE_PAGES): there is no per-role gate, because an update only some
 * staff can see is not an announcement.
 */
export default async function NewsPage({
  searchParams,
}: {
  searchParams?: { topic?: string; unread?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const requestedSlug = searchParams?.topic?.trim() || null;
  const unreadOnly = searchParams?.unread === "1";

  const [topics, unread] = await Promise.all([
    prisma.newsTopic.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, icon: true, color: true, description: true },
    }),
    unreadByTopic(userId),
  ]);

  // A ?topic= naming a topic that has since been renamed or switched off would
  // otherwise render an empty feed with no explanation. Fall back to "all".
  const activeSlug = topics.some((t) => t.slug === requestedSlug) ? requestedSlug : null;

  const items = await getFeed({ userId, topicSlug: activeSlug, unreadOnly });

  const chips: TopicChip[] = topics.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    icon: t.icon,
    color: t.color,
    description: t.description,
    unread: unread[t.id] ?? 0,
  }));

  const activeTopic = topics.find((t) => t.slug === activeSlug);

  return (
    <>
      <TopBar title="News & Updates" subtitle={activeTopic ? activeTopic.name : "All topics"} />
      <div className="p-margin">
        <NewsFeedClient
          items={items}
          topics={chips}
          activeSlug={activeSlug}
          unreadOnly={unreadOnly}
          totalUnread={Object.values(unread).reduce((a, b) => a + b, 0)}
          isAdmin={perms.isAdmin}
          hasTopics={topics.length > 0}
        />
      </div>
    </>
  );
}
