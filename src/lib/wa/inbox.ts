/**
 * The conversation list behind /crm/inbox.
 *
 * The filter rules live here as a pure function for the same reason
 * buildLeadWhere does: "which conversations is this consultant shown" is a rule
 * worth testing directly, not something to infer from a rendered page.
 *
 * Visibility mirrors the leads list exactly. Every CRM user may SEE every
 * conversation — the CRM has never scoped viewing by assignee — but a BDE
 * defaults to their own, because an inbox that opens on 4,000 threads belonging
 * to other people is not an inbox. Mutating (send, assign, close) is stricter
 * and gated per-conversation by canEditLead at the route.
 */
import type { Prisma } from "@prisma/client";
import { isSessionOpen } from "./mirror";

/** Which slice of the inbox to show. */
export const WA_INBOX_FILTERS = ["mine", "unassigned", "unread", "needs_reply", "all", "closed"] as const;
export type WaInboxFilter = (typeof WA_INBOX_FILTERS)[number];

/**
 * Resolve the landing filter.
 *
 * Takes the scope, because the default is role-dependent: a BDE opens on their
 * own threads, while an admin or supervisor opening on "mine" would see an empty
 * inbox — they own no conversations. Same shape as resolveAssigneeFilter on the
 * leads list, where an explicit choice always wins over the role default.
 */
export function normalizeInboxFilter(raw: string | null | undefined, scope?: { isBde: boolean }): WaInboxFilter {
  const v = (raw ?? "").trim();
  if ((WA_INBOX_FILTERS as readonly string[]).includes(v)) return v as WaInboxFilter;
  return scope?.isBde ? "mine" : "needs_reply";
}

export type InboxScope = {
  userId: string;
  /** A BDE defaults to their own threads; everyone else defaults to all. */
  isBde: boolean;
};

/** The `status` constraint a filter implies — exported so the chip counts agree with the list. */
export function inboxStatusWhere(filter: WaInboxFilter): Prisma.WaConversationWhereInput {
  return filter === "closed" ? { status: "closed" } : { status: { not: "closed" } };
}

/**
 * Build the `where` for the conversation list.
 *
 * `needs_reply` is the one that earns its place: a thread whose LAST message came
 * from the candidate is one nobody has answered. That is a different question
 * from "unread", which only records whether someone opened the tab, and it is
 * the question an inbox exists to answer.
 *
 * It reads a maintained `awaitingReply` column rather than comparing
 * `lastInboundAt` to `lastMessageAt`, because Prisma cannot compare two columns
 * in a `where` and post-filtering the fetched page would silently break
 * pagination — a page of 50 would arrive holding however many survived. The
 * column is set on every inbound message and cleared on every outbound send, so
 * it is derived from exactly one rule in exactly two places.
 */
export function buildInboxWhere(filter: WaInboxFilter, scope: InboxScope, search?: string | null): Prisma.WaConversationWhereInput {
  const where: Prisma.WaConversationWhereInput = {};
  // Closed threads are hidden from every working view — otherwise the close
  // button changes nothing the consultant can see.
  const and: Prisma.WaConversationWhereInput[] = [inboxStatusWhere(filter)];

  switch (filter) {
    case "mine":
      and.push({ assignedToId: scope.userId });
      break;
    case "unassigned":
      and.push({ assignedToId: null });
      break;
    case "unread":
      and.push({ unreadCount: { gt: 0 } });
      break;
    case "needs_reply":
      and.push({ awaitingReply: true });
      break;
    case "all":
    case "closed":
      break;
  }

  // A BDE looking at "all", "unread" or "needs_reply" still sees the whole team
  // by design — matching the leads list, where viewing is open and the default
  // is merely convenient. Only the default landing filter is personal.

  const q = (search ?? "").trim();
  if (q) {
    and.push({
      OR: [
        { phoneE164: { contains: q, mode: "insensitive" } },
        { lead: { candidateName: { contains: q, mode: "insensitive" } } },
        { lead: { email: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  if (and.length) where.AND = and;
  return where;
}

/**
 * The rule the `awaitingReply` column stores, in one place.
 *
 * Every outbound send bumps `lastMessageAt` and leaves `lastInboundAt` alone, so
 * the two being equal means the newest message on the thread was inbound. Used
 * to compute the column on write and to backfill existing rows; readers use the
 * column.
 */
export function isAwaitingReply(row: { lastInboundAt: Date | null; lastMessageAt: Date | null }): boolean {
  if (!row.lastInboundAt) return false;
  if (!row.lastMessageAt) return true;
  return row.lastInboundAt.getTime() >= row.lastMessageAt.getTime();
}

export type InboxRow = {
  id: string;
  phoneE164: string;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  sessionOpen: boolean;
  awaitingReply: boolean;
  /** Preview of the newest message, for the list. */
  preview: string | null;
  previewDirection: string | null;
  lead: { id: string; candidateName: string; statusLabel: string | null; statusColor: string | null } | null;
  assignedTo: { id: string; name: string } | null;
};

type ConversationWithPreview = {
  id: string;
  phoneE164: string;
  status: string;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  sessionExpiresAt: Date | null;
  awaitingReply: boolean;
  lead: {
    id: string;
    candidateName: string;
    status: { label: string; color: string | null } | null;
  } | null;
  assignedTo: { id: string; username: string; leadPulseRole: { displayName: string } | null } | null;
  messages: { body: string | null; type: string; direction: string }[];
};

export function serializeInboxRow(c: ConversationWithPreview): InboxRow {
  const newest = c.messages[0] ?? null;
  return {
    id: c.id,
    phoneE164: c.phoneE164,
    status: c.status,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    sessionOpen: isSessionOpen(c.sessionExpiresAt),
    awaitingReply: c.awaitingReply,
    // A media message with no caption still needs a line in the list.
    preview: newest ? (newest.body?.trim() || (newest.type !== "text" ? `[${newest.type}]` : null)) : null,
    previewDirection: newest?.direction ?? null,
    lead: c.lead
      ? {
          id: c.lead.id,
          candidateName: c.lead.candidateName,
          statusLabel: c.lead.status?.label ?? null,
          statusColor: c.lead.status?.color ?? null,
        }
      : null,
    assignedTo: c.assignedTo
      ? {
          id: c.assignedTo.id,
          name: c.assignedTo.leadPulseRole?.displayName ?? c.assignedTo.username,
        }
      : null,
  };
}
