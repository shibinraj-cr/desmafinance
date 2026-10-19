import { prisma } from "@/lib/prisma";
import { leadOwnersForPhone } from "@/lib/wa/identity";
import { MARKETING_ADMIN_ROLE_NAME } from "@/lib/crm-uncontacted-alarm";

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

/**
 * Best-effort: tell the Marketing Admin that someone replied to a broadcast and
 * nobody owns them. Never throws.
 *
 * Campaigns often go to leads with no owner — Centralised Marketing unassigns
 * on entry — and a reply on such a lead notifies nobody: there is no BDE to
 * ping, and the inbox's needs-reply badge only counts for whoever looks. So the
 * people who hand out unowned leads hear about it, once per campaign send (the
 * caller only calls on the first reply to a send).
 *
 * "Nobody owns them" reads the whole identity group, like reply rights do: a
 * duplicate row with no owner does not make a candidate whose live lead belongs
 * to a BDE look unowned.
 *
 * Recipients are the Marketing Admin population the uncontacted-lead alarm
 * uses: the Marketing Admin role, or any active Lead Pulse supervisor.
 */
export async function notifyUnownedBroadcastReply(opts: {
  conversationId: string;
  phoneE164: string;
  campaignName: string;
}): Promise<void> {
  try {
    const owners = await leadOwnersForPhone(opts.phoneE164);
    if (owners.length > 0) return;

    const recipients = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [{ roleRef: { name: MARKETING_ADMIN_ROLE_NAME } }, { leadPulseRole: { role: "supervisor", active: true } }],
      },
      select: { id: true },
    });
    if (recipients.length === 0) return;

    const conversation = await prisma.waConversation.findUnique({
      where: { id: opts.conversationId },
      select: { leadId: true, lead: { select: { candidateName: true } } },
    });
    const name = conversation?.lead?.candidateName?.trim() || "A candidate";
    await prisma.crmNotification.createMany({
      data: recipients.map((u) => ({
        userId: u.id,
        kind: "broadcast_reply",
        title: "Broadcast reply with no owner",
        body: `${name} replied to "${opts.campaignName}" and has no owner. Assign them so someone answers.`,
        linkUrl: `/crm/inbox?conversation=${opts.conversationId}`,
        leadId: conversation?.leadId ?? null,
      })),
    });
  } catch (e) {
    console.error("[crm-notify] failed to write unowned broadcast-reply notification:", e);
  }
}

/** The user's unread CRM-notification count. Best-effort — 0 on any error. */
export async function countUnreadCrmNotifications(userId: string): Promise<number> {
  return prisma.crmNotification.count({ where: { userId, readAt: null } }).catch(() => 0);
}
