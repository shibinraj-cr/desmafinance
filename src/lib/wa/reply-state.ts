/**
 * Who owes whom a message on a WhatsApp thread — the two flags on
 * WaConversation, written in one place.
 *
 *   awaitingReply — the candidate wrote last. "Needs reply" in the inbox, the
 *                   sidebar badge, My Day and the Reply Tracker's waiting list.
 *   autoReplied   — nobody has answered them, but an automated message (the
 *                   assignment intro, a task reminder, a re-marketing touch)
 *                   went out after their last one. "Bot replied".
 *
 * At most one is true. A person's send clears both; a new inbound message puts
 * the thread back to awaitingReply; an automated send moves a waiting thread to
 * autoReplied — it is not an answer, but the candidate now has a message from us
 * to respond to, so it is not the same work as a question nobody has seen.
 */
import { prisma } from "../prisma";

/** After a CRM user sends anything. */
export const HUMAN_REPLY_STATE = { awaitingReply: false, autoReplied: false } as const;

/** After the candidate's newest message arrives. */
export const INBOUND_REPLY_STATE = { awaitingReply: true, autoReplied: false } as const;

/**
 * After an automated send. Conditional on the thread waiting, so a bot message on
 * a thread a person already answered changes nothing.
 */
export async function markAutomatedSend(conversationId: string): Promise<void> {
  await prisma.waConversation.updateMany({
    where: { id: conversationId, awaitingReply: true },
    data: { awaitingReply: false, autoReplied: true },
  });
}
