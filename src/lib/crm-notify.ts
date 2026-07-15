import { prisma } from "@/lib/prisma";

/**
 * Best-effort: write an in-app notification when a lead is assigned or
 * reassigned to a user. Never throws — a notification failure must not break the
 * assignment that triggered it (mirrors `recordLeadActivity` and
 * `notifySupervisorOfReInquiries`). Fire-and-forget; returns void.
 *
 * No-ops when:
 *  - the actor is assigning to themselves (a BDE creating their own lead already
 *    knows — pinging them is just noise),
 *  - the assignee has no LeadPulseRole, is inactive, or has turned off
 *    `notifyOnAssign` (their per-user notification setting).
 */
export async function notifyLeadAssigned(opts: {
  assigneeUserId: string;
  actorUserId?: string | null;
  leadId: string;
  candidateName?: string | null;
  isReassignment?: boolean;
}): Promise<void> {
  try {
    // Self-assignment produces no notification.
    if (opts.actorUserId && opts.actorUserId === opts.assigneeUserId) return;

    const role = await prisma.leadPulseRole.findUnique({
      where: { userId: opts.assigneeUserId },
      select: { active: true, notifyOnAssign: true },
    });
    if (!role || !role.active || !role.notifyOnAssign) return;

    const name = opts.candidateName?.trim() || "A lead";
    await prisma.crmNotification.create({
      data: {
        userId: opts.assigneeUserId,
        kind: "lead_assigned",
        title: opts.isReassignment ? "Lead reassigned to you" : "New lead assigned to you",
        body: `${name} is now assigned to you.`,
        // Relative path — rendered as an in-app link on the Notifications page.
        linkUrl: `/crm/leads/${opts.leadId}`,
        leadId: opts.leadId,
      },
    });
  } catch (e) {
    console.error("[crm-notify] failed to write lead-assignment notification:", e);
  }
}

/** The user's unread CRM-notification count. Best-effort — 0 on any error. */
export async function countUnreadCrmNotifications(userId: string): Promise<number> {
  return prisma.crmNotification.count({ where: { userId, readAt: null } }).catch(() => 0);
}
