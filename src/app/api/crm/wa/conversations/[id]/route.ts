import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { isSessionOpen, markConversationRead } from "@/lib/wa/mirror";
import { canActOnConversation, canAssignConversation } from "@/lib/wa/access";

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
      status: { select: { label: true, color: true } },
      service: { select: { name: true } },
      source: { select: { label: true } },
      temperature: true,
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
        orderBy: { occurredAt: "asc" },
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

  const canAct = canActOnConversation(
    access,
    {
      leadAssignedToId: conversation.lead?.assignedToId ?? null,
      conversationAssignedToId: conversation.assignedToId,
      hasLead: !!conversation.lead,
    },
    userId,
  );

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
            statusLabel: conversation.lead.status?.label ?? null,
            statusColor: conversation.lead.status?.color ?? null,
            serviceName: conversation.lead.service?.name ?? null,
            sourceLabel: conversation.lead.source?.label ?? null,
            temperature: conversation.lead.temperature,
          }
        : null,
      assignedTo: conversation.assignedTo
        ? {
            id: conversation.assignedTo.id,
            name: conversation.assignedTo.leadPulseRole?.displayName ?? conversation.assignedTo.username,
          }
        : null,
      messages: conversation.messages.map((m) => ({
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
 */
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const patch = PatchSchema.parse(await req.json().catch(() => null));

  const conversation = await prisma.waConversation.findUnique({
    where: { id: params.id },
    select: { id: true, assignedToId: true, lead: { select: { assignedToId: true } } },
  });
  if (!conversation) throw notFound();

  const actor = {
    leadAssignedToId: conversation.lead?.assignedToId ?? null,
    conversationAssignedToId: conversation.assignedToId,
    hasLead: !!conversation.lead,
  };

  const data: { assignedToId?: string | null; status?: string } = {};

  if (patch.assignedToId !== undefined) {
    if (!canAssignConversation(access, actor, patch.assignedToId, userId)) throw forbidden();
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
    data.assignedToId = patch.assignedToId;
  }

  if (patch.status !== undefined) {
    if (!canActOnConversation(access, actor, userId)) throw forbidden();
    data.status = patch.status;
  }

  if (Object.keys(data).length === 0) throw badRequest("Nothing to update", "empty_patch");

  const updated = await prisma.waConversation.update({
    where: { id: params.id },
    data,
    select: { id: true, status: true, assignedToId: true },
  });

  return NextResponse.json({ conversation: updated });
});
