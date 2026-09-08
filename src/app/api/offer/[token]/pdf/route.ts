import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { hashToken } from "@/lib/hiring/envelope";
import { isHiringFile, blobPathnameFor, readHiringFile } from "@/lib/hiring/blob";

export const dynamic = "force-dynamic";

/**
 * GET /api/offer/[token]/pdf — the candidate's own countersigned copy.
 *
 * The files live in a private store, and the internal file route requires
 * `candidate:read` — which the candidate does not and should not have. Their
 * credential is the signing token they already hold, so it is what authorises
 * this. One envelope, one document, and nothing else reachable from it.
 */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { token: string } }) => {
  const envelope = await prisma.hiringOfferEnvelope.findUnique({
    where: { accessTokenHash: hashToken(params.token) },
    select: { pdfUrl: true, signedAt: true, signerName: true },
  });

  // Only after signing: before that there is no countersigned copy to hand over.
  if (!envelope?.signedAt || !envelope.pdfUrl) {
    throw notFound("There is no signed copy for this offer.");
  }
  if (!isHiringFile(envelope.pdfUrl)) {
    throw notFound("That document is not available here.");
  }

  const file = await readHiringFile(blobPathnameFor(envelope.pdfUrl));
  if (!file) throw notFound("That document is no longer in storage.");

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="desma-offer.pdf"',
      "cache-control": "private, no-store",
    },
  });
});
