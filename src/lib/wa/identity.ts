/**
 * Which consultants own a WhatsApp number.
 *
 * A thread is keyed by number — `WaConversation.phoneE164` is unique — but a
 * number routinely carries several leads: a Meta re-inquiry filed as a
 * `duplicate`, a re-enrollment opened for a second service, an import that
 * landed the same person twice. The mirror binds the thread to exactly one of
 * them (the oldest; see findLeadByPhone), which is fine for attribution and
 * wrong for permission — the oldest row is often the parked duplicate nobody
 * owns, while the live lead belongs to the consultant now being told the thread
 * is read-only.
 *
 * So permission asks this module instead: who owns ANY lead for this number.
 *
 * Phone only, never email. The transport's identity is the number, and email is
 * a weaker claim — one family address across two candidates would otherwise let
 * a consultant read a stranger's messages. `findLeadDuplicates` still matches on
 * both, because flagging a possible duplicate for a human to judge is a
 * different question from granting access.
 */
import { prisma } from "../prisma";

/**
 * The consultants owning a lead on this number, de-duplicated, unassigned leads
 * dropped.
 *
 * Both phone columns are matched, the same pair `syncConversationAssignee` and
 * the import path use: a candidate may well write from the alternate number they
 * gave us, and a lead reached on its `altPhoneE164` is no less theirs.
 *
 * An empty array means nobody owns this candidate — not "lookup failed" — so a
 * caller can treat it as the unassigned case without a second query.
 */
export async function leadOwnersForPhone(phoneE164: string | null | undefined): Promise<string[]> {
  const phone = phoneE164?.trim();
  if (!phone) return [];

  const leads = await prisma.lead.findMany({
    where: { OR: [{ phoneE164: phone }, { altPhoneE164: phone }] },
    select: { assignedToId: true },
  });

  return [...new Set(leads.map((l) => l.assignedToId).filter((id): id is string => !!id))];
}
