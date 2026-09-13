import { prisma } from "./prisma";
import { logger } from "./logger";
import { fromPrismaDate, todayIst } from "./lead-pulse-dates";
import { WEALTH_PAGE } from "./wealth-access";
import { remindersToRaise, type ReminderLike } from "./wealth-reminders";

/**
 * The daily nudge for investment reminders that have entered their lead window
 * or gone past due.
 *
 * It writes into CrmNotification — the app's only per-user notification table,
 * whose `kind` column exists for exactly this. The row is deliberately terse:
 * "3 investment reminders need attention", never the policy name or the amount.
 * The notifications list is a general surface, and the figures belong on the
 * private page the link points at, not in a feed.
 *
 * Each reminder is stamped `notifiedAt` so it is never raised twice, which also
 * makes the cron safe to re-run after a failed deploy.
 */
export async function notifyWealthDue(ownerUserId: string): Promise<number> {
  const today = todayIst();

  const setting = await prisma.wealthSetting.findUnique({
    where: { ownerUserId },
    select: { remindersEnabled: true },
  });
  // Absent settings default to on — a fresh desk should still nag.
  if (setting && !setting.remindersEnabled) return 0;

  const rows = await prisma.wealthReminder.findMany({
    where: { ownerUserId, status: "open", notifiedAt: null },
    select: {
      id: true,
      dueOn: true,
      status: true,
      amount: true,
      notifiedAt: true,
      holding: { select: { reminderLeadDays: true } },
    },
  });

  const candidates: (ReminderLike & { id: string })[] = rows.map((r) => ({
    id: r.id,
    dueOn: fromPrismaDate(r.dueOn),
    status: r.status,
    amount: r.amount === null ? null : Number(r.amount.toString()),
    leadDays: r.holding?.reminderLeadDays ?? 7,
    notifiedAt: r.notifiedAt,
  }));

  const due = remindersToRaise(candidates, today);
  if (due.length === 0) return 0;

  const overdue = due.filter((r) => r.dueOn < today).length;
  const soon = due.length - overdue;

  const parts: string[] = [];
  if (overdue > 0) parts.push(`${overdue} overdue`);
  if (soon > 0) parts.push(`${soon} coming up`);

  await prisma.crmNotification.create({
    data: {
      userId: ownerUserId,
      kind: "wealth_due",
      title:
        overdue > 0
          ? `${overdue} investment reminder${overdue === 1 ? "" : "s"} overdue`
          : `${soon} investment reminder${soon === 1 ? "" : "s"} coming up`,
      // No names, no amounts — those live behind the link.
      body: `${parts.join(" · ")}. Open the Personal Wealth desk to see what and settle it.`,
      linkUrl: WEALTH_PAGE,
    },
  });

  await prisma.wealthReminder.updateMany({
    where: { id: { in: due.map((r) => r.id) } },
    data: { notifiedAt: new Date() },
  });

  logger.info("wealth_reminders_notified", { ownerUserId, overdue, soon });
  return due.length;
}

/** Every user who has anything on a wealth desk — the cron's work list. */
export async function wealthOwnerIds(): Promise<string[]> {
  const [holdings, liabilities] = await Promise.all([
    prisma.wealthHolding.findMany({
      where: { archivedAt: null },
      select: { ownerUserId: true },
      distinct: ["ownerUserId"],
    }),
    prisma.wealthLiability.findMany({
      where: { closedAt: null },
      select: { ownerUserId: true },
      distinct: ["ownerUserId"],
    }),
  ]);
  return [...new Set([...holdings, ...liabilities].map((r) => r.ownerUserId))];
}
