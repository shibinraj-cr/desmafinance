import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { canViewConversation } from "@/lib/wa/access";
import { findOrCreateConversationForLead } from "@/lib/wa/mirror";
import { sendWaMessage } from "@/lib/wa/send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const StartSchema = z.object({
  template: z.string().min(1).max(200),
  templateParams: z.record(z.string(), z.string()).optional(),
});

/**
 * POST /api/crm/leads/[id]/wa/start — first outbound message on a lead with no
 * WhatsApp thread yet.
 *
 * Template-only, deliberately: WhatsApp only allows a business to originate a
 * conversation with an approved template, never free text — there is no
 * session to be "open" before the candidate has said anything. The thread
 * itself is created here (see findOrCreateConversationForLead), the one place
 * the CRM originates one instead of finding it already written by an inbound
 * webhook.
 *
 * Same permission as every other lead action: the assigned consultant, a
 * supervisor, or an admin (canEditLead).
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();

  const access = await getCrmAccess(userId, perms);

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, phoneE164: true, assignedToId: true },
  });
  if (!lead) throw notFound();
  if (!canEditLead(access, lead, userId)) throw forbidden();
  if (!lead.phoneE164) {
    throw badRequest("This lead has no normalised phone number, so WhatsApp can't be started.", "no_phone");
  }

  const data = StartSchema.parse(await req.json().catch(() => null));

  const conv = await findOrCreateConversationForLead({
    id: lead.id,
    phoneE164: lead.phoneE164,
    assignedToId: lead.assignedToId,
  });
  if (!conv.ok) {
    return NextResponse.json(
      {
        error: conv.reason,
        message: "This phone number already has a WhatsApp conversation attached to a different lead.",
      },
      { status: 409 },
    );
  }

  // The conversation resolved above may predate this request — a thread the
  // inbox already handed to a different consultant without moving the lead
  // (see src/lib/wa/access.ts). canEditLead only cleared the LEAD; the thread
  // itself is the more sensitive resource, so it gets its own check before
  // anything is sent into it.
  const row = await prisma.waConversation.findUnique({
    where: { id: conv.conversationId },
    select: { assignedToId: true },
  });
  const viewable = canViewConversation(
    access,
    { leadAssignedToId: lead.assignedToId, conversationAssignedToId: row?.assignedToId ?? null },
    userId,
  );
  if (!viewable) throw forbidden();

  const result = await sendWaMessage({
    conversationId: conv.conversationId,
    sentById: userId,
    template: data.template,
    templateParams: data.templateParams,
  });

  if (!result.ok) {
    const status =
      result.reason === "session_closed" ? 409 : result.reason === "unsupported" ? 503 : result.reason === "no_conversation" ? 404 : 502;
    return NextResponse.json({ error: result.reason, message: result.detail }, { status });
  }

  return NextResponse.json({ ok: true, messageId: result.messageId });
});
