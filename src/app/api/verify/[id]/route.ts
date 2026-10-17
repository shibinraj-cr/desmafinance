import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { HttpError } from "@/lib/http-error";
import { rateLimit } from "@/lib/hiring/rate-limit";
import { requestOrigin } from "@/lib/esign/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/verify/[id] — does this fingerprint match the signed agreement?
 * The browser hashes the file; only the SHA-256 is sent. Nothing personal is
 * returned, and the summary only when the file matches.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { ip } = requestOrigin(req);
  if (!rateLimit(`esign:verify:${ip ?? "unknown"}`, 30, 10 * 60 * 1000).ok) {
    throw new HttpError(429, "Too many checks. Wait a few minutes.", "rate_limited");
  }
  const { sha256 } = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }).parse(await req.json().catch(() => null));
  const r = await prisma.esignRequest.findUnique({
    where: { id: params.id },
    select: {
      status: true,
      signedSha256: true,
      completedAt: true,
      templateVersion: { select: { template: { select: { name: true } } } },
      _count: { select: { signers: true } },
    },
  });
  if (!r || r.status !== "signed" || !r.signedSha256) return NextResponse.json({ match: false });
  if (r.signedSha256 !== sha256) return NextResponse.json({ match: false });
  return NextResponse.json({
    match: true,
    document: r.templateVersion?.template.name ?? "Agreement",
    completedAt: r.completedAt?.toISOString() ?? null,
    signers: r._count.signers,
  });
});
