import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayIst, toPrismaDate, formatIstShort } from "@/lib/lead-pulse-dates";
import { MEDIA_PLANNER_HREF } from "@/lib/media-plan";

export const dynamic = "force-dynamic";

/**
 * Morning nudge for the media plan: every open production step that is due
 * today or overdue (on an item that has not shipped) turns into one in-app
 * notification digest per responsible user. `remindedOn` dedupes to a single
 * ping per task per IST day, so extra cron triggers are harmless.
 *
 * In-app only for now — these go to teammates, not candidates, so the
 * WhatsApp template/opt-out machinery the CRM task reminders need does not
 * apply. Scheduled at 9:00 IST in vercel.json.
 *
 * Auth matches the other crons: Vercel sends `Authorization: Bearer
 * $CRON_SECRET`, and `?key=` is accepted for manual triggering. Fail-closed
 * when the secret is unset.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not set — media plan reminders disabled" },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const today = todayIst();
  const todayDate = toPrismaDate(today);

  const due = await prisma.mediaPlanTask.findMany({
    where: {
      status: "open",
      dueDate: { lte: todayDate },
      OR: [{ remindedOn: null }, { remindedOn: { lt: todayDate } }],
      item: { status: { not: "published" } },
    },
    include: { item: { select: { title: true, ownerId: true } } },
    orderBy: { dueDate: "asc" },
  });

  // One digest per responsible user, not one ping per step.
  const byUser = new Map<string, typeof due>();
  for (const task of due) {
    const recipient = task.assignedToId ?? task.item.ownerId;
    if (!recipient) continue;
    const list = byUser.get(recipient) ?? [];
    list.push(task);
    byUser.set(recipient, list);
  }

  let notified = 0;
  for (const [recipient, tasks] of Array.from(byUser.entries())) {
    const overdue = tasks.filter((t) => t.dueDate && t.dueDate < todayDate).length;
    const lines = tasks
      .slice(0, 6)
      .map(
        (t) =>
          `${t.name} — ${t.item.title}${t.dueDate ? ` (due ${formatIstShort(t.dueDate.toISOString().slice(0, 10))})` : ""}`,
      );
    const more = tasks.length > lines.length ? ` …and ${tasks.length - lines.length} more.` : "";
    try {
      await prisma.crmNotification.create({
        data: {
          userId: recipient,
          kind: "media_task_due",
          title: overdue
            ? `Media plan: ${tasks.length} step${tasks.length === 1 ? "" : "s"} need attention (${overdue} overdue)`
            : `Media plan: ${tasks.length} step${tasks.length === 1 ? "" : "s"} due today`,
          body: lines.join(" · ") + more,
          linkUrl: MEDIA_PLANNER_HREF,
        },
      });
      notified += 1;
      await prisma.mediaPlanTask.updateMany({
        where: { id: { in: tasks.map((t) => t.id) } },
        data: { remindedOn: todayDate },
      });
    } catch (e) {
      // A failed notification must not stop the other recipients' digests.
      console.error("[media-plan-reminders] failed for recipient:", recipient, e);
    }
  }

  return NextResponse.json({ ok: true, today, dueTasks: due.length, usersNotified: notified });
}

export const GET = handle;
export const POST = handle;
