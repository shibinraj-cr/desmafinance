import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { canActOnConversation } from "@/lib/wa/access";
import { sendWaVoiceNote } from "@/lib/wa/send";
import { remuxToOggOpus, remuxFailureMessage, WA_VOICE_MIME } from "@/lib/wa/audio-remux";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** A remux is milliseconds, but the upload to Meta is a file transfer. */
export const maxDuration = 60;

/**
 * Biggest recording we will accept.
 *
 * Comfortably under the platform's own request-body ceiling, which cannot be
 * raised and which answers an oversized upload with a bare 413 that says
 * nothing. At the bitrate the composer records, this is several minutes of
 * speech — far more than a voice note wants to be, and WhatsApp itself only
 * shows an inline play button below 512 KB.
 */
const MAX_UPLOAD_BYTES = 4_000_000;

/**
 * POST /api/crm/wa/conversations/[id]/audio — send a recorded voice note.
 *
 * The recording arrives in whatever container the browser could produce and is
 * republished as Ogg/Opus here, because Meta accepts five audio types and the
 * one Chrome records is not among them. That conversion is a remux rather than a
 * transcode — same Opus packets, different framing — which is what lets it
 * happen in a serverless function at all.
 *
 * It happens on this side rather than in the browser for a reason worth stating:
 * this is the last point at which the result can be checked. A wrong codec
 * reaching Meta comes back as error 131053, in production, with a message that
 * lists the legal formats without saying which one you sent. Verifying here
 * turns that into a logged failure and a sentence the consultant can act on.
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

  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof Blob)) throw badRequest("No recording was attached");
  if (file.size === 0) throw badRequest("That recording was empty");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw badRequest("That recording is too long — keep voice notes under a couple of minutes");
  }

  const remuxed = await remuxToOggOpus(await file.arrayBuffer());
  if (!remuxed.ok) {
    // Logged with the reason because `not_opus` is a browser we have not met and
    // `remux_failed` is a bug of ours, and only one of those is worth chasing.
    logger.warn("wa_voice_remux_failed", {
      conversationId: params.id,
      reason: remuxed.reason,
      detail: remuxed.detail,
    });
    // 422: the request was well-formed and we understood it, the audio inside
    // just cannot become a WhatsApp voice note. Never falls through to sending
    // the raw bytes — that is precisely how a production-only rejection happens.
    return NextResponse.json(
      { error: remuxed.reason, message: remuxFailureMessage(remuxed.reason) },
      { status: 422 },
    );
  }

  const result = await sendWaVoiceNote({
    conversationId: params.id,
    sentById: userId,
    bytes: remuxed.bytes,
    mime: WA_VOICE_MIME,
    // Ogg/Opus mono is exactly what a push-to-talk note requires, and the remux
    // has just proven all three, so this is a fact rather than a hope.
    voice: true,
  });

  if (!result.ok) {
    const status =
      result.reason === "session_closed"
        ? 409
        : result.reason === "unsupported"
          ? 503
          : result.reason === "no_conversation"
            ? 404
            : 502;
    return NextResponse.json({ error: result.reason, message: result.detail }, { status });
  }

  return NextResponse.json({ ok: true, messageId: result.messageId });
});
