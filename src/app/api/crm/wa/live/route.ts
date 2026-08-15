import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { getWaMirrorConfig } from "@/lib/wa/mirror";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Enough to see who is waiting without turning the sidebar into a second inbox. */
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

  // A BDE sees their own threads; everyone else sees the whole desk. Same rule
  // as the inbox's landing filter — the sidebar must not disagree with the page
  // it links to, or the count will look wrong the moment it is clicked.
  const scope = access.isBde
    ? { assignedToId: userId }
    : {};

  const where = { status: { not: "closed" }, awaitingReply: true, ...scope } as const;

  const [count, conversations] = await Promise.all([
    prisma.waConversation.count({ where }),
    prisma.waConversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: PREVIEW_LIMIT,
      select: {
        id: true,
        phoneE164: true,
        lastMessageAt: true,
        unreadCount: true,
        lead: { select: { id: true, candidateName: true } },
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
    conversations: conversations.map((c) => {
      const newest = c.messages[0] ?? null;
      return {
        id: c.id,
        name: c.lead?.candidateName || c.phoneE164,
        leadId: c.lead?.id ?? null,
        unreadCount: c.unreadCount,
        lastMessageAt: c.lastMessageAt,
        // A media message with no caption still needs a line.
        preview: newest ? (newest.body?.trim() || (newest.type !== "text" ? `[${newest.type}]` : null)) : null,
      };
    }),
  });
});
