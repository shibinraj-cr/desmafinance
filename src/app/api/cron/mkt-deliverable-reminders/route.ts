import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayIst, toPrismaDate, formatIstShort, fromPrismaDate } from "@/lib/lead-pulse-dates";
import { MKT_PLANNER_HREF } from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

/**
 * Morning nudge for the Marketing Planner: every open campaign deliverable due
 * today or overdue (on a campaign that is still going ahead) becomes one in-app
 * digest per owner. `remindedOn` dedupes to one ping per deliverable per IST
 * day, so extra triggers are harmless. Scheduled at 9:00 IST in vercel.json,
 * alongside the Media Planner's reminders.
 *
 * Auth matches the other crons: `Authorization: Bearer $CRON_SECRET`, or
 * `?key=` for a manual run. Fail-closed when the secret is unset.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not set — marketing planner reminders disabled" },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const today = todayIst();
  const todayDate = toPrismaDate(today);

  const due = await prisma.mktDeliverable.findMany({
    where: {
      doneAt: null,
      dueDate: { lte: todayDate },
      OR: [{ remindedOn: null }, { remindedOn: { lt: todayDate } }],
      campaign: { status: { notIn: ["cancelled", "done"] } },
    },
    include: { campaign: { select: { id: true, name: true, ownerId: true } } },
    orderBy: { dueDate: "asc" },
  });

  const byUser = new Map<string, typeof due>();
  for (const d of due) {
    const recipient = d.ownerId ?? d.campaign.ownerId;
    if (!recipient) continue;
    const list = byUser.get(recipient) ?? [];
    list.push(d);
    byUser.set(recipient, list);
  }

  let notified = 0;
  for (const [recipient, items] of Array.from(byUser.entries())) {
    const overdue = items.filter((d) => d.dueDate && d.dueDate < todayDate).length;
    const lines = items
      .slice(0, 6)
      .map(
        (d) =>
          `${d.title} — ${d.campaign.name}${d.dueDate ? ` (due ${formatIstShort(fromPrismaDate(d.dueDate))})` : ""}`,
      );
    const more = items.length > lines.length ? ` …and ${items.length - lines.length} more.` : "";
    // One campaign → link straight to it; several → the planner overview.
    const campaignIds = Array.from(new Set(items.map((d) => d.campaign.id)));
    try {
      await prisma.crmNotification.create({
        data: {
          userId: recipient,
          kind: "mkt_deliverable_due",
          title: overdue
            ? `Marketing plan: ${items.length} deliverable${items.length === 1 ? "" : "s"} need attention (${overdue} overdue)`
            : `Marketing plan: ${items.length} deliverable${items.length === 1 ? "" : "s"} due today`,
          body: lines.join(" · ") + more,
          linkUrl: campaignIds.length === 1 ? `${MKT_PLANNER_HREF}/campaigns/${campaignIds[0]}` : MKT_PLANNER_HREF,
        },
      });
      notified += 1;
      await prisma.mktDeliverable.updateMany({
        where: { id: { in: items.map((d) => d.id) } },
        data: { remindedOn: todayDate },
      });
    } catch (e) {
      // One failed digest must not stop the others.
      console.error("[mkt-deliverable-reminders] failed for recipient:", recipient, e);
    }
  }

  return NextResponse.json({ ok: true, today, due: due.length, usersNotified: notified });
}

export const GET = handle;
export const POST = handle;
