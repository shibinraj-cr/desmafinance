import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { buildInboxWhere, normalizeInboxFilter, serializeInboxRow } from "@/lib/wa/inbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/crm/wa/conversations — the inbox list.
 *
 * Ordered by `lastMessageAt` desc, which is the only order an inbox can have:
 * the thread that moved most recently is the one a consultant is looking for.
 * Threads that have never carried a message sort last rather than first, since
 * a null would otherwise float an empty conversation above live ones.
 *
 * Viewing is open to every CRM user, matching the leads list — the CRM has never
 * scoped viewing by assignee. What a BDE gets instead is a personal DEFAULT
 * filter, applied in normalizeInboxFilter/buildInboxWhere.
 */
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const sp = new URL(req.url).searchParams;
  const filter = normalizeInboxFilter(sp.get("filter"), { isBde: access.isBde });
  const search = sp.get("q");
  // Floored and floored-at-1: Prisma requires an Int, and a negative `take`
  // means "page backwards", which the hasMore/slice arithmetic below cannot
  // express — an unvalidated `?limit=-5` would silently return the wrong page.
  const requested = Math.floor(Number(sp.get("limit")));
  const take = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_PAGE_SIZE) : PAGE_SIZE;
  const cursor = sp.get("cursor");

  const where = buildInboxWhere(filter, { userId, isBde: access.isBde }, search);

  const rows = await prisma.waConversation.findMany({
    where,
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: take + 1, // one extra row is how we know there is a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      phoneE164: true,
      status: true,
      unreadCount: true,
      lastMessageAt: true,
      lastInboundAt: true,
      sessionExpiresAt: true,
      awaitingReply: true,
      lead: {
        select: { id: true, candidateName: true, status: { select: { label: true, color: true } } },
      },
      assignedTo: { select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } } },
      // Newest message only — the list shows a one-line preview, not a thread.
      messages: {
        orderBy: { occurredAt: "desc" },
        take: 1,
        select: { body: true, type: true, direction: true },
      },
    },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  // Counts for the filter chips. Deliberately independent of the CURRENT filter —
  // the point of a badge is to say what is waiting in the tab you are not looking
  // at — but they must exclude closed threads exactly as the lists do, or a badge
  // will promise work that clicking through cannot show.
  const open = { status: { not: "closed" } } as const;
  const [needsReply, unread, unassigned] = await Promise.all([
    prisma.waConversation.count({ where: { ...open, awaitingReply: true } }),
    prisma.waConversation.count({ where: { ...open, unreadCount: { gt: 0 } } }),
    prisma.waConversation.count({ where: { ...open, assignedToId: null } }),
  ]);

  return NextResponse.json({
    conversations: page.map(serializeInboxRow),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    counts: { needsReply, unread, unassigned },
    filter,
  });
});
