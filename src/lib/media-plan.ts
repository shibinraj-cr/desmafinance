import type { Prisma } from "@prisma/client";
import type { Permissions } from "./rbac";
import { canSeePage, isAdmin } from "./rbac";
import { fromPrismaDate } from "./lead-pulse-dates";
import { MEDIA_PLANNER_HREF, type MediaItemDto, type MediaTaskDto } from "./media-plan-shared";

/**
 * Media Planner — server-side helpers. The pure vocabulary (formats,
 * statuses, targets, DTO types) lives in ./media-plan-shared so the client
 * component can import it too; this module re-exports it for server code.
 */
export * from "./media-plan-shared";

/**
 * Access follows the Meta Reconcile pattern: not adminOnly, gated by an
 * explicit page grant so the Marketing Admin role can hold the tool without
 * full admin. Everyone who can open the page can plan on it — it is a shared
 * team calendar, not a per-row-owned surface.
 */
export function canUseMediaPlanner(perms: Permissions | null | undefined): boolean {
  if (!perms) return false;
  return isAdmin(perms) || canSeePage(perms, MEDIA_PLANNER_HREF);
}

export const mediaItemInclude = {
  tasks: { orderBy: [{ seq: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.MediaPlanItemInclude;

type ItemWithTasks = Prisma.MediaPlanItemGetPayload<{ include: typeof mediaItemInclude }>;

export function serializeMediaTask(t: ItemWithTasks["tasks"][number]): MediaTaskDto {
  return {
    id: t.id,
    name: t.name,
    seq: t.seq,
    dueDate: t.dueDate ? fromPrismaDate(t.dueDate) : null,
    status: t.status,
    assignedToId: t.assignedToId,
    doneAt: t.doneAt ? t.doneAt.toISOString() : null,
  };
}

export function serializeMediaItem(item: ItemWithTasks): MediaItemDto {
  return {
    id: item.id,
    title: item.title,
    format: item.format,
    status: item.status,
    publishDate: item.publishDate ? fromPrismaDate(item.publishDate) : null,
    publishTime: item.publishTime,
    shootDate: item.shootDate ? fromPrismaDate(item.shootDate) : null,
    hook: item.hook,
    ownerId: item.ownerId,
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
    tasks: item.tasks.map(serializeMediaTask),
  };
}
