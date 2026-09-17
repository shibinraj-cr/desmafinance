import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { isSessionOpen, markConversationRead } from "@/lib/wa/mirror";
import { canViewConversation } from "@/lib/wa/access";
import { leadOwnersForPhone } from "@/lib/wa/identity";
import { getWaProvider } from "@/lib/wa/registry";
import { filterTemplatesFor, leadPulseRoleOf, loadTemplateGrants, templateKey } from "@/lib/wa/template-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Newest-first would need reversing to render; the thread reads oldest-first. */
const MESSAGE_LIMIT = 200;

/**
 * GET /api/crm/leads/[id]/wa — the lead's WhatsApp thread.
 *
 * Reads the mirror the CRM stores, not a live pull from the provider. If the
 * mirror is off or the candidate has never messaged, `conversation` is null and
 * the UI says so plainly rather than pretending the thread is empty.
 *
 * Returns `send` alongside — the transport's capabilities and the templates THIS
 * user may use — so the lead page can offer the same composer as the inbox. It
 * rides with the thread rather than being threaded as props through the whole
 * lead-detail page, since this panel is the only thing there that needs it.
 *
 * Two different permissions come back. `canReply` is the lead's edit right; the
 * thread itself is separately scoped by canViewConversation, because a lead is a
 * name and a stage while a conversation is the candidate's own words.
 */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedToId: true, phoneE164: true },
  });
  if (!lead) throw notFound();

  // A thread is found by its link first and by NUMBER second — including a
  // number whose thread is bound to a different lead.
  //
  // That match used to be restricted to unlinked threads, on the reasoning that
  // one number maps to several leads (re-enrollment, an import filed twice) and
  // the other lead's tab should not show "a conversation that belongs to a
  // different record". In practice those rows are the same person: the mirror
  // binds the thread to the OLDEST lead on the number, which for an imported
  // candidate is routinely the parked duplicate, so the guard hid the thread
  // from the one lead anybody was working and offered "start a conversation"
  // that could only 409. One number is one candidate and one thread; showing it
  // on each of their leads is the honest rendering of that.
  //
  // Permission is unaffected — it is decided below, per consultant, not by which
  // lead the mirror happened to bind.
  const conversation = await prisma.waConversation.findFirst({
    where: {
      OR: [
        { leadId: lead.id },
        ...(lead.phoneE164 ? [{ phoneE164: lead.phoneE164 }] : []),
      ],
    },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      phoneE164: true,
      status: true,
      lastMessageAt: true,
      lastInboundAt: true,
      sessionExpiresAt: true,
      unreadCount: true,
      assignedToId: true,
      messages: {
        // NEWEST first, reversed below for display. Ascending with a cap shows
        // the OLDEST 200 — which was invisible while no thread had 200 rows, and
        // becomes the default the moment months of history are imported: the
        // reader lands on 2024 template blasts with every recent message below
        // the cap, and a composer under a conversation that ends a year ago.
        orderBy: { occurredAt: "desc" },
        take: MESSAGE_LIMIT,
        select: {
          id: true,
          direction: true,
          type: true,
          body: true,
          mediaMime: true,
          fileName: true,
          // Presence only — the bytes come from /api/crm/wa/media/<messageId>,
          // which authorises per conversation. See the inbox thread reader.
          mediaId: true,
          mediaUrl: true,
          templateName: true,
          waStatus: true,
          waErrorCode: true,
          waErrorMessage: true,
          // The tick alone answers "did it arrive"; the time answers "when", and
          // a failure's own sentence answers "why" without anybody having to
          // look up a Meta error code.
          waStatusAt: true,
          occurredAt: true,
          // The BDE roster name is what the team calls each other; username is
          // the fallback for a sender with no Lead Pulse role.
          sentBy: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
        },
      },
    },
  });

  const canReply = canEditLead(access, lead, userId);

  // Capabilities and templates ride along with the thread rather than being
  // threaded as props through the whole lead-detail page — this panel is the
  // only thing on it that needs them, and the templates are per-user anyway.
  const provider = await getWaProvider();
  const [waTemplates, grants, myTier] = await Promise.all([
    provider.listTemplates().catch(() => []),
    loadTemplateGrants().catch(() => []),
    leadPulseRoleOf(userId).catch(() => null),
  ]);
  const templates = filterTemplatesFor(
    waTemplates.filter((t) => t.status === "APPROVED"),
    access,
    grants,
    myTier,
  ).map((t) => ({
    id: templateKey(t.name, t.language),
    name: templateKey(t.name, t.language),
    label: `${t.name} (${t.language})`,
    body: t.body,
    header: t.header,
    variableCount: t.variableCount,
  }));

  const send = {
    providerLabel: provider.label,
    canSendText: provider.supports("sendText"),
    canSendTemplate: provider.supports("sendTemplate"),
    templates,
  };

  // Lead VISIBILITY is open across the CRM, but a WhatsApp thread is the
  // candidate's own words — so it is scoped even here, on a lead the consultant
  // is otherwise allowed to open. They see the lead; they do not see someone
  // else's conversation with them.
  if (
    conversation &&
    !canViewConversation(
      access,
      {
        // Owners across the whole identity group, so a consultant who owns this
        // lead is not refused the thread because the mirror bound it elsewhere.
        leadOwnerIds: await leadOwnersForPhone(conversation.phoneE164),
        conversationAssignedToId: conversation.assignedToId,
      },
      userId,
    )
  ) {
    return NextResponse.json({ conversation: null, canReply, restricted: true, send });
  }

  if (!conversation) {
    return NextResponse.json({ conversation: null, canReply, send });
  }

  // Opening the thread clears the badge — but only for someone who owns the
  // work. `canViewLeads` is granted to every BDE, supervisor and admin and is
  // NOT scoped by assignee, so gating the write on it would let any colleague
  // browsing the lead (or a link prefetch, or a re-render) silently clear the
  // assigned consultant's unread count. `unreadCount` is a single shared column,
  // not per-user, so that loss is unrecoverable.
  //
  // Best-effort — a failed counter reset must not cost the user the messages
  // they came to read.
  if (conversation.unreadCount > 0 && canReply) await markConversationRead(conversation.id);

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      phoneE164: conversation.phoneE164,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt,
      lastInboundAt: conversation.lastInboundAt,
      sessionExpiresAt: conversation.sessionExpiresAt,
      /// Whether free text is still legal — see WA_SESSION_WINDOW_MS.
      sessionOpen: isSessionOpen(conversation.sessionExpiresAt),
      // Back into reading order — the query took the newest slice, not the oldest.
      messages: [...conversation.messages].reverse().map((m) => ({
        id: m.id,
        direction: m.direction,
        type: m.type,
        body: m.body,
        mediaMime: m.mediaMime,
        fileName: m.fileName,
        hasMedia: !!(m.mediaId || m.mediaUrl),
        templateName: m.templateName,
        waStatus: m.waStatus,
        waErrorCode: m.waErrorCode,
        waErrorMessage: m.waErrorMessage,
        waStatusAt: m.waStatusAt,
        occurredAt: m.occurredAt,
        sentByName: m.sentBy?.leadPulseRole?.displayName ?? m.sentBy?.username ?? null,
      })),
      truncated: conversation.messages.length === MESSAGE_LIMIT,
    },
    canReply,
    send,
  });
});
