import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { canActOnConversation } from "@/lib/wa/access";
import { sendWaMessage, WA_MAX_TEXT_LENGTH } from "@/lib/wa/send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SendSchema = z.object({
  body: z.string().max(WA_MAX_TEXT_LENGTH).optional(),
  template: z.string().max(200).optional(),
  templateParams: z.record(z.string(), z.string()).optional(),
  renderedBody: z.string().max(WA_MAX_TEXT_LENGTH).optional(),
});

/**
 * POST /api/crm/wa/conversations/[id]/messages — reply on a thread.
 *
 * The interesting failures are the honest ones. Two of them are not errors in
 * the usual sense and must not be rendered as "something went wrong":
 *
 *   - 409 `session_closed` — the 24-hour free-text window has lapsed since the
 *     tab was rendered. The consultant is not at fault and the fix is specific:
 *     send an approved template. Re-checked server-side precisely because a
 *     stale tab is the case the client cannot get right.
 *   - 503 `unsupported` — the live transport genuinely cannot do this. Through
 *     Wabis, free text has no API to call; retrying will never help. Surfacing
 *     it as its own status keeps the UI able to say WHY rather than showing a
 *     generic failure the consultant will keep retrying.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const conversation = await prisma.waConversation.findUnique({
    where: { id: params.id },
    select: { id: true, assignedToId: true, lead: { select: { assignedToId: true } } },
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
  if (!canAct) throw forbidden();

  const data = SendSchema.parse(await req.json().catch(() => null));

  const result = await sendWaMessage({
    conversationId: params.id,
    sentById: userId,
    body: data.body ?? null,
    template: data.template ?? null,
    templateParams: data.templateParams,
    renderedBody: data.renderedBody ?? null,
  });

  if (!result.ok) {
    const status =
      result.reason === "session_closed" ? 409 : result.reason === "unsupported" ? 503 : result.reason === "no_conversation" ? 404 : 502;
    return NextResponse.json({ error: result.reason, message: result.detail }, { status });
  }

  return NextResponse.json({ ok: true, messageId: result.messageId });
});
