import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { internalSigner } from "@/lib/esign/internal-signer";
import { completeSigning } from "@/lib/esign/signing";
import { SubmissionSchema } from "@/lib/esign/submission";
import { esignBaseUrl } from "@/lib/esign/base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** POST /api/esign/requests/[id]/sign/complete — DESMA staff sign inside DesGro (their login is the proof). */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { request, signer, userId, user, origin } = await internalSigner(req, params.id);
  const submission = SubmissionSchema.parse(await req.json().catch(() => null));
  const result = await completeSigning({
    requestId: request.id,
    signerId: signer.id,
    submission,
    origin,
    actor: user?.email ?? user?.username ?? signer.name,
    verifiedBy: `Signed in to DesGro as ${user?.username ?? "staff"}`,
    baseUrl: esignBaseUrl(req),
    actorUserId: userId,
  });
  return NextResponse.json(result);
});
