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
import { canEditLead, type CrmAccess } from "../crm-rbac";

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
  conv: { conversationAssignedToId: string | null },
  targetUserId: string | null,
  userId: string,
): boolean {
  if (access.canAssign) return true;
  const claimingUnassigned = conv.conversationAssignedToId === null && targetUserId === userId;
  return claimingUnassigned && access.isBde;
}
