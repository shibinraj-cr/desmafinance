/**
 * Who may act on a conversation.
 *
 * Reading is settled by the CRM's existing posture — every CRM user may see
 * every lead, so every CRM user may read every thread. Acting is not, and this
 * file exists because a conversation can outlive or precede its lead, so
 * `canEditLead` alone does not cover every case.
 *
 * Three situations, three answers:
 *
 *   - LINKED to a lead — defer entirely to canEditLead, so the WhatsApp thread
 *     obeys exactly the same rule as the lead's notes, tasks and comms. A BDE
 *     acts on their own leads; admins and supervisors act on any.
 *   - UNLINKED but assigned — the assignee acts, plus admins and supervisors.
 *   - UNLINKED and unassigned — any BDE may act, because this is the unassigned
 *     queue and somebody has to be able to pick a stranger's message up. Locking
 *     it to admins would leave first-contact messages sitting unanswered, which
 *     is the exact failure the inbox exists to prevent.
 */
import type { Prisma } from "@prisma/client";
import { canEditLead, type CrmAccess } from "../crm-rbac";

/**
 * May this user see EVERY conversation, or only their own?
 *
 * Conversations are treated as more sensitive than the leads they belong to.
 * The CRM has always let any user view any lead — name, stage, service — but a
 * WhatsApp thread is the candidate's own words, often about money, visas or
 * personal circumstances. So this is scoped where lead viewing is not:
 * oversight roles see the whole desk, a consultant sees the candidates they are
 * responsible for.
 *
 * Deliberately keyed on ROLE rather than on named individuals, so granting a
 * person the whole-desk view is a role change in the CRM rather than a code
 * change here.
 */
export function canViewAllConversations(access: CrmAccess): boolean {
  return access.isAdmin || access.isSupervisor || access.isCrmTeamLead || access.canManageCrm;
}

/**
 * The `where` restricting a conversation list to what this user may see.
 *
 * Empty for oversight roles. For a consultant, a thread is theirs when its LEAD
 * is theirs — or when the thread itself was handed to them, which covers a
 * conversation that has no lead yet (a stranger's first message) and one passed
 * to them without moving the lead.
 */
export function conversationVisibilityWhere(
  access: CrmAccess,
  userId: string,
): Prisma.WaConversationWhereInput {
  if (canViewAllConversations(access)) return {};
  return { OR: [{ lead: { assignedToId: userId } }, { assignedToId: userId }] };
}

/** Whether one already-loaded conversation is visible to this user. */
export function canViewConversation(
  access: CrmAccess,
  conv: { leadAssignedToId: string | null; conversationAssignedToId: string | null },
  userId: string,
): boolean {
  if (canViewAllConversations(access)) return true;
  return conv.leadAssignedToId === userId || conv.conversationAssignedToId === userId;
}

export type ConversationActor = {
  leadAssignedToId: string | null;
  conversationAssignedToId: string | null;
  hasLead: boolean;
};

export function canActOnConversation(access: CrmAccess, conv: ConversationActor, userId: string): boolean {
  if (conv.hasLead) {
    return canEditLead(access, { assignedToId: conv.leadAssignedToId }, userId);
  }
  if (access.isAdmin || access.isSupervisor) return true;
  if (conv.conversationAssignedToId) return conv.conversationAssignedToId === userId;
  return access.isBde;
}

/**
 * Who may hand a thread to someone else.
 *
 * Reassignment is the CRM's existing `canAssign` capability — the same marker
 * that lets a sales-team lead redistribute leads — rather than something a BDE
 * can do to their own workload. Claiming an UNASSIGNED thread is different and
 * deliberately open to any BDE: taking work off the unassigned queue is not the
 * same act as moving work between people.
 */
export function canAssignConversation(
  access: CrmAccess,
  conv: ConversationActor,
  targetUserId: string | null,
  userId: string,
): boolean {
  if (access.canAssign) return true;

  // The claim carve-out is for work nobody owns. A thread whose LEAD belongs to
  // another consultant is owned — the conversation's own `assignedToId` is only
  // copied from the lead when the thread is created and is never backfilled, so
  // "conversation unassigned" does not mean "unowned". Checking the lead too is
  // what stops a BDE quietly pulling a colleague's candidate onto themselves.
  const leadOwnedByOther = conv.hasLead && !!conv.leadAssignedToId && conv.leadAssignedToId !== userId;
  if (leadOwnedByOther) return false;

  const claimingUnassigned = conv.conversationAssignedToId === null && targetUserId === userId;
  return claimingUnassigned && access.isBde;
}
