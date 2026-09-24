import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { todayIst } from "@/lib/lead-pulse-dates";
import { canUseMediaPlanner, mediaItemInclude, serializeMediaItem } from "@/lib/media-plan";
import { MediaPlannerClient } from "./client";

export const dynamic = "force-dynamic";

export default async function MediaPlannerPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!canUseMediaPlanner(perms)) redirect("/");

  const today = todayIst();
  const yearNow = Number(today.slice(0, 4));
  const monthNow = Number(today.slice(5, 7));
  const year = searchParams.year ? Number(searchParams.year) : yearNow;
  const month = searchParams.month ? Number(searchParams.month) : monthNow;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) redirect("/marketing/media-planner");
  if (!Number.isInteger(month) || month < 1 || month > 12) redirect("/marketing/media-planner");

  // The visible calendar grid spans up to a week before the 1st and after the
  // last day (leading/trailing cells of other months), so fetch that range —
  // plus every not-yet-published item regardless of date for the board and
  // the task rail.
  const first = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, daysInMonth));
  const gridEnd = new Date(last);
  gridEnd.setUTCDate(daysInMonth + (6 - last.getUTCDay()));

  const [items, users] = await Promise.all([
    prisma.mediaPlanItem.findMany({
      where: {
        OR: [
          { publishDate: { gte: gridStart, lte: gridEnd } },
          { status: { not: "published" } },
        ],
      },
      orderBy: [{ publishDate: "asc" }, { createdAt: "asc" }],
      include: mediaItemInclude,
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    }),
  ]);

  return (
    <MediaPlannerClient
      year={year}
      month={month}
      todayStr={today}
      items={items.map(serializeMediaItem)}
      users={users}
      selfId={userId}
    />
  );
}
