import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { isSessionOpen, markConversationRead } from "@/lib/wa/mirror";
import { canActOnConversation, canAssignConversation, canViewConversation } from "@/lib/wa/access";
import { findLeadDuplicates } from "@/lib/crm-leads";
import { assignLeadTo } from "@/lib/crm-assign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MESSAGE_LIMIT = 200;

const conversationSelect = {
  id: true,
  phoneE164: true,
  status: true,
  unreadCount: true,
  lastMessageAt: true,
  lastInboundAt: true,
  sessionExpiresAt: true,
  awaitingReply: true,
  assignedToId: true,
  lead: {
    select: {
      id: true,
      candidateName: true,
      email: true,
      phone: true,
      assignedToId: true,
      // The ids, not just the labels: the rail edits these in place, and a
      // dropdown cannot preselect what it was only given the label of.
      statusId: true,
      serviceId: true,
      sourceId: true,
      qualificationId: true,
      country: true,
      studyDestination: true,
      temperature: true,
      emailKey: true,
      phoneE164: true,
      status: { select: { label: true, color: true } },
      service: { select: { name: true } },
      source: { select: { label: true } },
      qualification: { select: { label: true } },
    },
  },
  assignedTo: { select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } } },
} as const;

/**
 * GET /api/crm/wa/conversations/[id] — one thread, plus the lead context the
 * inbox's right-hand rail renders.
 *
 * That rail is the entire reason to read WhatsApp here rather than in Wabis, so
 * the lead's stage, service, source and temperature come back with the messages
 * instead of costing a second round trip.
 */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const conversation = await prisma.waConversation.findUnique({
    where: { id: params.id },
    select: {
      ...conversationSelect,
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
          templateName: true,
          waStatus: true,
          waErrorCode: true,
          occurredAt: true,
          sentBy: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
        },
      },
    },
  });
  if (!conversation) throw notFound();

  // A consultant may only open a thread that is theirs. notFound rather than
  // forbidden: whether a conversation exists for some other candidate is itself
  // information they are not entitled to.
  if (
    !canViewConversation(
      access,
      {
        leadAssignedToId: conversation.lead?.assignedToId ?? null,
        conversationAssignedToId: conversation.assignedToId,
      },
      userId,
    )
  ) {
    throw notFound();
  }

  const canAct = canActOnConversation(
    access,
    {
      leadAssignedToId: conversation.lead?.assignedToId ?? null,
      conversationAssignedToId: conversation.assignedToId,
      hasLead: !!conversation.lead,
    },
    userId,
  );

  // Duplicates and recent activity are fetched with the thread rather than on
  // demand: both are things you want to know BEFORE replying, and a panel that
  // loads them after the first keystroke tells you too late.
  const [duplicates, activity] = await Promise.all([
    conversation.lead
      ? findLeadDuplicates({
          id: conversation.lead.id,
          emailKey: conversation.lead.emailKey,
          phoneE164: conversation.lead.phoneE164,
        }).catch(() => [])
      : Promise.resolve([]),
    conversation.lead
      ? prisma.leadActivity.findMany({
          where: { leadId: conversation.lead.id },
          orderBy: { occurredAt: "desc" },
          take: 3,
          select: {
            id: true,
            type: true,
            summary: true,
            occurredAt: true,
            actor: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
          },
        })
      : Promise.resolve([]),
  ]);

  // Opening clears the badge — but only for someone who owns the work.
  // `unreadCount` is one shared column, not per-user, so letting any viewer zero
  // it would lose the assigned consultant's signal irrecoverably.
  if (conversation.unreadCount > 0 && canAct) await markConversationRead(conversation.id);

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      phoneE164: conversation.phoneE164,
      status: conversation.status,
      awaitingReply: conversation.awaitingReply,
      lastMessageAt: conversation.lastMessageAt,
      lastInboundAt: conversation.lastInboundAt,
      sessionExpiresAt: conversation.sessionExpiresAt,
      sessionOpen: isSessionOpen(conversation.sessionExpiresAt),
      lead: conversation.lead
        ? {
            id: conversation.lead.id,
            candidateName: conversation.lead.candidateName,
            email: conversation.lead.email,
            phone: conversation.lead.phone,
            statusId: conversation.lead.statusId,
            serviceId: conversation.lead.serviceId,
            sourceId: conversation.lead.sourceId,
            qualificationId: conversation.lead.qualificationId,
            country: conversation.lead.country,
            studyDestination: conversation.lead.studyDestination,
            temperature: conversation.lead.temperature,
            statusLabel: conversation.lead.status?.label ?? null,
            statusColor: conversation.lead.status?.color ?? null,
            serviceName: conversation.lead.service?.name ?? null,
            sourceLabel: conversation.lead.source?.label ?? null,
            qualificationLabel: conversation.lead.qualification?.label ?? null,
          }
        : null,
      duplicates,
      activity: activity.map((a) => ({
        id: a.id,
        type: a.type,
        summary: a.summary,
        occurredAt: a.occurredAt,
        actorName: a.actor?.leadPulseRole?.displayName ?? a.actor?.username ?? null,
      })),
      assignedTo: conversation.assignedTo
        ? {
            id: conversation.assignedTo.id,
            name: conversation.assignedTo.leadPulseRole?.displayName ?? conversation.assignedTo.username,
          }
        : null,
      // Back into reading order — the query took the newest slice, not the oldest.
      messages: [...conversation.messages].reverse().map((m) => ({
        id: m.id,
        direction: m.direction,
        type: m.type,
        body: m.body,
        mediaMime: m.mediaMime,
        fileName: m.fileName,
        templateName: m.templateName,
        waStatus: m.waStatus,
        waErrorCode: m.waErrorCode,
        occurredAt: m.occurredAt,
        sentByName: m.sentBy?.leadPulseRole?.displayName ?? m.sentBy?.username ?? null,
      })),
      truncated: conversation.messages.length === MESSAGE_LIMIT,
    },
    canAct,
  });
});

const PatchSchema = z.object({
  assignedToId: z.string().nullable().optional(),
  status: z.enum(["open", "closed"]).optional(),
});

/**
 * PATCH /api/crm/wa/conversations/[id] — hand the thread over, or close it.
 *
 * Closing is triage only: it takes a thread out of the working list and says
 * nothing about the deal. The lead's own status remains the single source of
 * truth for where the candidate is in the pipeline, which is why nothing here
 * touches it.
 *
 * Assignment is different: the Lead is the CRM's one system of record for who
 * owns a candidate, so reassigning a thread that is linked to a lead goes
 * through assignLeadTo — the same path the Pipeline's own assign endpoint
 * uses — rather than writing WaConversation.assignedToId on its own. That
 * keeps the inbox's "Owner" control and the Pipeline's assignee from ever
 * disagreeing about who has this candidate. An unlinked thread (no lead yet)
 * has nothing to sync to, so it still updates directly.
 */
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const patch = PatchSchema.parse(await req.json().catch(() => null));

  const conversation = await prisma.waConversation.findUnique({
    where: { id: params.id },
    select: { id: true, leadId: true, assignedToId: true, lead: { select: { assignedToId: true } } },
  });
  if (!conversation) throw notFound();

  const actor = {
    leadAssignedToId: conversation.lead?.assignedToId ?? null,
    conversationAssignedToId: conversation.assignedToId,
    hasLead: !!conversation.lead,
  };

  if (patch.assignedToId === undefined && patch.status === undefined) {
    throw badRequest("Nothing to update", "empty_patch");
  }

  if (patch.assignedToId !== undefined) {
    if (!canAssignConversation(access, actor, patch.assignedToId, userId)) throw forbidden();

    if (conversation.leadId) {
      await assignLeadTo(conversation.leadId, patch.assignedToId, userId);
    } else {
      if (patch.assignedToId) {
        // Same roster rule the lead assign route enforces, so a thread can never
        // be parked on someone who is not an active consultant.
        const role = await prisma.leadPulseRole.findUnique({
          where: { userId: patch.assignedToId },
          select: { role: true, active: true },
        });
        if (!role || !role.active || (role.role !== "l1" && role.role !== "l2")) {
          throw badRequest("Assignee must be an active L1/L2 BDE", "invalid_assignee");
        }
      }
      await prisma.waConversation.update({ where: { id: conversation.id }, data: { assignedToId: patch.assignedToId } });
    }
  }

  if (patch.status !== undefined) {
    if (!canActOnConversation(access, actor, userId)) throw forbidden();
    await prisma.waConversation.update({ where: { id: conversation.id }, data: { status: patch.status } });
  }

  const updated = await prisma.waConversation.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, assignedToId: true },
  });

  return NextResponse.json({ conversation: updated });
});
