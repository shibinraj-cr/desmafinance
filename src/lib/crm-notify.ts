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
 * The people who hand out leads: anyone with the Marketing Admin role, or any
 * active Lead Pulse supervisor — the population the uncontacted-lead alarm
 * nags. Active users only.
 */
export async function marketingAdminUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ roleRef: { name: MARKETING_ADMIN_ROLE_NAME } }, { leadPulseRole: { role: "supervisor", active: true } }],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** The bell text for a re-inquiry, worded for the lead's owner or for the Marketing Admin. */
export function buildReInquiryNotification(
  p: { candidateName: string; source?: string | null; campaign?: string | null; revived: boolean; owned: boolean },
  forOwner: boolean,
): { title: string; body: string } {
  const name = p.candidateName.trim() || "A lead";
  const via = p.campaign ? ` via ${p.campaign}` : p.source ? ` via ${p.source}` : "";
  const parts = [`${name} enquired again${via}.`];
  if (p.revived) parts.push("Re-opened to Re-marketing.");
  if (!p.owned) parts.push("Nobody owns this lead — assign a consultant.");
  return { title: forOwner ? "Your lead enquired again" : "Re-inquiry", body: parts.join(" ") };
}

/**
 * Best-effort: a bell notification for every re-inquiry, from any source (form
 * webhook, import, manual entry, Instagram, a Voxbay call…), to the lead's
 * owner and the Marketing Admin. Never throws. The person who triggered it (an
 * importing user re-entering a lead) isn't told about their own action, and an
 * inactive owner is skipped.
 */
export async function notifyReInquiry(opts: {
  leadId: string;
  candidateName: string;
  ownerId: string | null;
  actorId?: string | null;
  source?: string | null;
  campaign?: string | null;
  revived: boolean;
  /** The Marketing Admin ids, when the caller resolved them once for a batch. */
  marketingAdminIds?: string[];
}): Promise<void> {
  try {
    const [admins, owner] = await Promise.all([
      opts.marketingAdminIds ?? marketingAdminUserIds(),
      opts.ownerId
        ? prisma.user.findFirst({ where: { id: opts.ownerId, isActive: true }, select: { id: true } })
        : Promise.resolve(null),
    ]);
    const recipients = new Set([...(owner ? [owner.id] : []), ...admins]);
    if (opts.actorId) recipients.delete(opts.actorId);
    if (recipients.size === 0) return;

    const text = { ...opts, owned: !!opts.ownerId };
    await prisma.crmNotification.createMany({
      data: [...recipients].map((userId) => ({
        userId,
        kind: "re_inquiry",
        ...buildReInquiryNotification(text, userId === owner?.id),
        linkUrl: `/crm/leads/${opts.leadId}`,
        leadId: opts.leadId,
      })),
    });
  } catch (e) {
    console.error("[crm-notify] failed to write re-inquiry notifications:", e);
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

    const recipients = await marketingAdminUserIds();
    if (recipients.length === 0) return;

    const conversation = await prisma.waConversation.findUnique({
      where: { id: opts.conversationId },
      select: { leadId: true, lead: { select: { candidateName: true } } },
    });
    const name = conversation?.lead?.candidateName?.trim() || "A candidate";
    await prisma.crmNotification.createMany({
      data: recipients.map((userId) => ({
        userId,
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
