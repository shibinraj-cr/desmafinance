import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { canViewConversation } from "@/lib/wa/access";
import { getWaProvider } from "@/lib/wa/registry";
import type { WaMediaStream } from "@/lib/wa/provider";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The bytes of an attachment, streamed through us.
 *
 * A voice note the candidate sent was already being stored — `mediaId` has been
 * on WaMessage since the mirror shipped — but nothing could play it, because a
 * Cloud API media id is not something a browser can resolve. Meta's download URL
 * requires the bearer token and expires within minutes, so it can neither be put
 * in an `<audio src>` nor cached in the row and used later. The attachment was
 * present, addressable and unreachable.
 *
 * So the CRM fetches it and streams it on, which it has to do anyway for a
 * second reason: handing that URL to the browser would mean handing over a
 * credential that unlocks every media id on the WABA, not just this one.
 *
 * Authorised per message, through the conversation it belongs to. The id is a
 * cuid rather than a sequence, but "hard to guess" is not an access rule — an L2
 * BDE must not be able to read another consultant's attachment, and that is the
 * same visibility question the thread reader already answers.
 */
export const GET = withApiHandler(async (req: Request, { params }: { params: { messageId: string } }) => {
  const messageId = params.messageId;

  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);

  const message = await prisma.waMessage.findUnique({
    where: { id: messageId },
    select: {
      mediaId: true,
      mediaUrl: true,
      mediaMime: true,
      fileName: true,
      conversation: {
        select: { assignedToId: true, lead: { select: { assignedToId: true } } },
      },
    },
  });
  if (!message?.conversation) throw notFound();

  const visible = canViewConversation(
    access,
    {
      leadAssignedToId: message.conversation.lead?.assignedToId ?? null,
      conversationAssignedToId: message.conversation.assignedToId,
    },
    userId,
  );
  if (!visible) throw forbidden();

  // Dragging the scrubber makes a browser ask for a byte range. Forwarded so
  // seeking costs a slice instead of the whole file again — and so the audio
  // element gets the 206 it expects rather than a fresh 200 that resets it.
  const stream = await openMedia(message, req.headers.get("range"));
  if (!stream) throw notFound();

  const headers = new Headers({
    "content-type": message.mediaMime || stream.mime || "application/octet-stream",
    // Inline so an <audio> element plays it in place; a download would defeat
    // the point of a voice note. The filename still travels for the cases a
    // browser does offer to save.
    "content-disposition": `inline${message.fileName ? `; filename="${sanitiseFilename(message.fileName)}"` : ""}`,
    // Private and short: the payload is somebody's message, and the upstream URL
    // behind it expires anyway. Long enough that scrubbing an audio element does
    // not re-fetch on every drag.
    "cache-control": "private, max-age=300",
    // The bytes are a candidate's file of unknown provenance. Without this a
    // crafted upload could be served from our origin and run as our page.
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  });
  if (stream.contentLength) headers.set("content-length", stream.contentLength);
  if (stream.contentRange) headers.set("content-range", stream.contentRange);
  headers.set("accept-ranges", "bytes");

  // Streamed, not buffered: a long voice note or a document should not be read
  // into this function's memory before the first byte reaches the browser.
  return new Response(stream.body, { status: stream.status, headers });
});

/**
 * Open the bytes for this message, whichever transport delivered it.
 *
 * Two provenances, deliberately handled apart. A message the Cloud API delivered
 * carries only a `mediaId`, exchanged through the provider on every read because
 * the resulting URL expires. A message imported from Wabis carries a `mediaUrl`
 * on their own storage — Meta never saw that file, so asking Meta for it would
 * only fail.
 */
async function openMedia(
  message: { mediaId: string | null; mediaUrl: string | null },
  range: string | null,
): Promise<WaMediaStream | null> {
  if (message.mediaId) {
    const provider = await getWaProvider();
    if (provider.supports("fetchMedia")) {
      const opened = await provider.downloadMedia(message.mediaId, range);
      if (opened) return opened;
    }
  }

  // Only http(s), and no credential of ours goes with it. A stored value is
  // provider data: `file:` here would turn this route into a reader of whatever
  // the server can reach, and sending our token to a third-party host merely
  // because it holds a file of ours would hand over the whole account.
  if (message.mediaUrl && /^https?:\/\//i.test(message.mediaUrl)) {
    try {
      const res = await fetch(message.mediaUrl, {
        headers: range ? { range } : {},
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok || !res.body) return null;
      return {
        body: res.body,
        mime: res.headers.get("content-type"),
        fileName: null,
        contentLength: res.headers.get("content-length"),
        contentRange: res.headers.get("content-range"),
        status: res.status === 206 ? 206 : 200,
      };
    } catch (e) {
      logger.warn("wa_media_url_failed", { message: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }
  return null;
}

/** Keep a provider-supplied name out of the header grammar it is interpolated into. */
function sanitiseFilename(name: string): string {
  return name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
}
