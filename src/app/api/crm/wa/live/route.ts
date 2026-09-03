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
 * GET /api/crm/wa/live — the unanswered-thread count behind the sidebar's
 * WhatsApp badge.
 *
 * Polled, so it is built to be cheap and to say "stop polling" when there is
 * nothing to poll for. There is no push channel here: the app runs on serverless
 * functions with no websocket to hold open, so "live" means a short poll from a
 * visible tab. That is stated plainly rather than dressed up, because the gap
 * between "live" and "every 20 seconds" matters when someone is waiting on a
 * reply.
 *
 * Two counts, no thread list: the sidebar shows a number, and the inbox itself
 * is the place to read threads. Dropping the preview query also drops its joins
 * from a request that runs every 20 seconds per open tab.
 *
 * Returns `enabled: false` when the mirror is off — the client then stops
 * polling entirely instead of asking a question whose answer cannot change.
 *
 * Never 401s a signed-in user without CRM access; it returns an empty, disabled
 * payload so the sidebar simply renders no badge.
 */
export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) {
    return NextResponse.json({ enabled: false, reason: "no_access", count: 0, waiting: 0 });
  }

  const config = await getWaMirrorConfig();
  if (!config.enabled) {
    return NextResponse.json({ enabled: false, reason: "mirror_off", count: 0, waiting: 0 });
  }

  // The same HARD visibility scope the inbox uses — a consultant sees the
  // candidates they are responsible for, oversight roles see the desk. The
  // badge must not disagree with the page it links to, or a count leads
  // somewhere that shows less than it promised.
  const scope = conversationVisibilityWhere(access, userId);
  const where = { status: { not: "closed" }, ...scope } as const;

  const [count, waiting] = await Promise.all([
    prisma.waConversation.count({ where }),
    prisma.waConversation.count({ where: { ...where, awaitingReply: true } }),
  ]);

  return NextResponse.json({ enabled: true, count, waiting });
});
