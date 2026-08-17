import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { getWaMirrorConfig } from "@/lib/wa/mirror";
import { conversationVisibilityWhere } from "@/lib/wa/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Enough to work from without turning the sidebar into a second inbox — and
 * short enough that the box's natural height leaves room for the nav tabs
 * above it instead of crowding them out.
 */
const PREVIEW_LIMIT = 5;

/**
 * GET /api/crm/wa/live — the sidebar's unanswered-conversation ticker.
 *
 * Polled, so it is built to be cheap and to say "stop polling" when there is
 * nothing to poll for. There is no push channel here: the app runs on serverless
 * functions with no websocket to hold open, so "live" means a short poll from a
 * visible tab. That is stated plainly rather than dressed up, because the gap
 * between "live" and "every 20 seconds" matters when someone is waiting on a
 * reply.
 *
 * Returns `enabled: false` when the mirror is off — the client then stops
 * polling entirely instead of asking a question whose answer cannot change.
 *
 * Never 401s a signed-in user without CRM access; it returns an empty, disabled
 * payload so the sidebar simply renders nothing.
 */
export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) {
    return NextResponse.json({ enabled: false, reason: "no_access", count: 0, conversations: [] });
  }

  const config = await getWaMirrorConfig();
  if (!config.enabled) {
    return NextResponse.json({ enabled: false, reason: "mirror_off", count: 0, conversations: [] });
  }

  // The same HARD visibility scope the inbox uses — a consultant sees the
  // candidates they are responsible for, oversight roles see the desk. The
  // sidebar must not disagree with the page it links to, or a count leads
  // somewhere that shows less than it promised.
  const scope = conversationVisibilityWhere(access, userId);

  // Every open thread, not just the unanswered ones — this is a live view of the
  // desk. The unanswered COUNT is reported separately, because that is the
  // number worth acting on and it would be lost if the list were the only signal.
  const where = { status: { not: "closed" }, ...scope } as const;

  const [count, waiting, conversations] = await Promise.all([
    prisma.waConversation.count({ where }),
    prisma.waConversation.count({ where: { ...where, awaitingReply: true } }),
    prisma.waConversation.findMany({
      where,
      // Threads with no message yet sort last rather than floating above live
      // ones on a null.
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      take: PREVIEW_LIMIT,
      select: {
        id: true,
        phoneE164: true,
        lastMessageAt: true,
        unreadCount: true,
        awaitingReply: true,
        lead: { select: { id: true, candidateName: true } },
        assignedTo: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
        messages: {
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: { body: true, type: true, direction: true },
        },
      },
    }),
  ]);

  return NextResponse.json({
    enabled: true,
    count,
    waiting,
    conversations: conversations.map((c) => {
      const newest = c.messages[0] ?? null;
      return {
        id: c.id,
        name: c.lead?.candidateName || c.phoneE164,
        leadId: c.lead?.id ?? null,
        unreadCount: c.unreadCount,
        awaitingReply: c.awaitingReply,
        lastMessageAt: c.lastMessageAt,
        // Shown so it is obvious at a glance whether a thread has an owner —
        // an unassigned one is nobody's job until someone picks it up.
        assignedToName: c.assignedTo?.leadPulseRole?.displayName ?? c.assignedTo?.username ?? null,
        // A media message with no caption still needs a line.
        preview: newest ? (newest.body?.trim() || (newest.type !== "text" ? `[${newest.type}]` : null)) : null,
        previewDirection: newest?.direction ?? null,
      };
    }),
  });
});
