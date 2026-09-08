import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * In-app notifications for the hiring module.
 *
 * Deliberately reuses `CrmNotification` rather than adding a parallel table.
 * Despite the name, that table is already the app's general in-app notification
 * store — the eTimeOffice subscription warnings (an HR concern) write to it
 * too, and its `kind` column exists precisely as a discriminator for other
 * event types. A second table would mean a second unread count, a second bell,
 * and a second thing to remember to render.
 *
 * Best-effort throughout: a notification that fails must never break the thing
 * that triggered it.
 */

export type HiringNotificationKind =
  | "hiring_scorecard_due"
  | "hiring_offer_expiring"
  | "hiring_req_stalled"
  | "hiring_automation_paused"
  | "hiring_assigned";

export async function notifyUsers(opts: {
  userIds: string[];
  title: string;
  body: string;
  href?: string;
  kind?: HiringNotificationKind;
}): Promise<number> {
  const unique = [...new Set(opts.userIds.filter(Boolean))];
  if (!unique.length) return 0;

  try {
    const { count } = await prisma.crmNotification.createMany({
      data: unique.map((userId) => ({
        userId,
        kind: opts.kind ?? "hiring_scorecard_due",
        title: opts.title,
        body: opts.body,
        linkUrl: opts.href ?? null,
      })),
    });
    return count;
  } catch (e) {
    logger.error("hiring_notify_failed", {
      kind: opts.kind,
      recipients: unique.length,
      message: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }
}
