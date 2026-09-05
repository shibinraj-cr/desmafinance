import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { logger } from "@/lib/logger";
import { signEnvelope } from "@/lib/hiring/envelope";
import { rateLimit } from "@/lib/hiring/rate-limit";
import { clientIp } from "@/lib/hiring/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  typedName: z.string().trim().min(2).max(120),
  signatureImageDataUrl: z.string().max(700_000).nullable().optional(),
});

/**
 * POST /api/offer/[token]/sign — the PUBLIC signing endpoint.
 *
 * Unauthenticated by necessity: the candidate has no Desgro login, and the
 * token in the URL is the credential. Rate-limited per IP so the token space
 * cannot be walked, and the response never distinguishes "no such token" from
 * "wrong token" beyond what the reader legitimately needs.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { token: string } }) => {
  const ip = clientIp() ?? "unknown";
  const limited = rateLimit(`offer:sign:${ip}`, 10, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  const body = schema.parse(await req.json());
  const result = await signEnvelope({
    rawToken: params.token,
    typedName: body.typedName,
    signatureImageDataUrl: body.signatureImageDataUrl ?? null,
    ip: clientIp(),
    userAgent: req.headers.get("user-agent"),
  });

  logger.info("hiring_offer_signed", { offerId: result.offerId });
  return NextResponse.json({ ok: true, pdfUrl: result.pdfUrl });
});
