import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { NewsManageClient, type ManageSource, type ManageTopic } from "./client";

export const dynamic = "force-dynamic";

/**
 * /news/manage — where the links behind the feed are registered. Admin only:
 * anyone who can add a source decides what the whole company reads.
 */
export default async function NewsManagePage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!perms.isAdmin) redirect("/news");

  const topics = await prisma.newsTopic.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { items: true, sources: true } },
      sources: {
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { items: true } } },
      },
    },
  });

  const modelTopics: ManageTopic[] = topics.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    icon: t.icon,
    color: t.color,
    sortOrder: t.sortOrder,
    isActive: t.isActive,
    itemCount: t._count.items,
    sourceCount: t._count.sources,
    sources: t.sources.map(
      (s): ManageSource => ({
        id: s.id,
        topicId: s.topicId,
        name: s.name,
        url: s.url,
        kind: s.kind,
        isActive: s.isActive,
        lastFetchedAt: s.lastFetchedAt ? s.lastFetchedAt.toISOString() : null,
        lastStatus: s.lastStatus,
        lastError: s.lastError,
        lastItemCount: s.lastItemCount,
        itemCount: s._count.items,
      }),
    ),
  }));

  return (
    <>
      <TopBar title="Topics & Sources" subtitle="News & Updates" />
      <div className="p-margin">
        <NewsManageClient topics={modelTopics} />
      </div>
    </>
  );
}
