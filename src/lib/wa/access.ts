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
 *   - LINKED to a lead — the same rule as canEditLead, but read across every
 *     lead sharing the thread's NUMBER rather than the single lead the thread
 *     happens to be bound to. A BDE acts on their own candidates; admins and
 *     supervisors act on any.
 *   - UNLINKED but assigned — the assignee acts, plus admins and supervisors.
 *   - UNLINKED and unassigned — any BDE may act, because this is the unassigned
 *     queue and somebody has to be able to pick a stranger's message up. Locking
 *     it to admins would leave first-contact messages sitting unanswered, which
 *     is the exact failure the inbox exists to prevent.
 *
 * Why the identity GROUP and not the bound lead — the correctness of this file
 * now rests on it. One number can carry several leads (a Meta re-inquiry filed
 * as a duplicate, a re-enrollment for a second service), but a number has
 * exactly one thread, and the mirror binds that thread to the OLDEST of them.
 * For an imported candidate the oldest row is routinely the parked `duplicate`
 * that nobody owns, while the lead actually being worked is newer. Reading the
 * bound lead alone then locks the consultant who owns the live lead out of the
 * candidate's own thread — read-only on a conversation the candidate is waiting
 * in, with a 24-hour window running down.
 *
 * The group is matched on PHONE only, never email. The thread IS a phone number
 * (WaConversation.phoneE164 is unique), so phone identity is the same identity
 * the transport uses. Email is a weaker claim — a shared family address or a
 * typo puts two different people in one group — and it must not widen who can
 * read a candidate's words.
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
 *
 * Unlike canViewConversation this cannot read the whole identity group: the
 * group is matched on phone, and Prisma has no way to express "conversations
 * whose number matches any lead of mine" in a `where` without pulling every one
 * of a consultant's lead numbers into an `IN`. In practice the second arm
 * covers it — syncConversationAssignee stamps the thread from the lead's owner
 * on every assign, matching by number, so a thread whose live lead is theirs is
 * normally assigned to them too. The gap is a thread stamped for a colleague by
 * an older assignment on a sibling lead: it stays out of this consultant's list
 * while remaining readable if they open it from the lead. Listing is a
 * convenience; access is decided by the functions above.
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
  conv: { leadOwnerIds: string[]; conversationAssignedToId: string | null },
  userId: string,
): boolean {
  if (canViewAllConversations(access)) return true;
  return conv.leadOwnerIds.includes(userId) || conv.conversationAssignedToId === userId;
}

export type ConversationActor = {
  /**
   * Every consultant who owns a lead for this thread's NUMBER — see the file
   * header. Not just the one lead the thread is bound to, and de-duplicated with
   * unassigned leads dropped, so an empty array means "nobody owns this
   * candidate" rather than "the bound lead is unassigned". Built by
   * leadOwnersForPhone in ./identity.
   */
  leadOwnerIds: string[];
  conversationAssignedToId: string | null;
  hasLead: boolean;
};

export function canActOnConversation(access: CrmAccess, conv: ConversationActor, userId: string): boolean {
  // Oversight first — the population canEditLead grants wholesale — so it holds
  // in every branch below, including a linked thread whose whole identity group
  // happens to be unassigned and would otherwise match nothing.
  if (access.isAdmin || access.isSupervisor) return true;
  // Still canEditLead, asked once per owner rather than once: the WhatsApp
  // thread keeps obeying exactly the rule the lead's notes, tasks and comms
  // obey, so the two cannot drift.
  //
  // Deliberately NOT falling back to the conversation's own assignee here. That
  // column is maintained by syncConversationAssignee, which stamps it from the
  // last lead assigned on this number — a reasonable signal, but a derived one.
  // The leads are the record of who owns the candidate, so they are what is
  // asked.
  if (conv.hasLead) {
    return conv.leadOwnerIds.some((ownerId) => canEditLead(access, { assignedToId: ownerId }, userId));
  }
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

  // The claim carve-out is for work nobody owns. A candidate whose LEAD belongs
  // to another consultant is owned — the conversation's own `assignedToId` can
  // be null on a thread that is plainly somebody's, so "conversation unassigned"
  // does not mean "unowned". Checking the leads too is what stops a BDE quietly
  // pulling a colleague's candidate onto themselves. Read across the identity
  // group for the same reason acting is: one duplicate row nobody owns must not
  // make a candidate look unclaimed.
  const leadOwnedByOther =
    conv.hasLead && conv.leadOwnerIds.length > 0 && !conv.leadOwnerIds.includes(userId);
  if (leadOwnedByOther) return false;

  const claimingUnassigned = conv.conversationAssignedToId === null && targetUserId === userId;
  return claimingUnassigned && access.isBde;
}
