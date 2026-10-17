import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { publicSigner } from "@/lib/esign/public-signer";
import { maskEmail, maskPhone } from "@/lib/esign/requests";
import { completeSigning } from "@/lib/esign/signing";
import { SubmissionSchema } from "@/lib/esign/submission";
import { esignBaseUrl } from "@/lib/esign/base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Stamping, possibly sealing with the certificate, then emails.
export const maxDuration = 120;

/** POST /api/sign/[token]/complete — sign and finish. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { token: string } }) => {
  const { request, signer, origin } = await publicSigner(req, params.token, { needSession: true });
  const submission = SubmissionSchema.parse(await req.json().catch(() => null));
  const channel = signer.otpChannel === "whatsapp" ? `WhatsApp (${maskPhone(signer.phone)})` : `email (${maskEmail(signer.email)})`;
  const result = await completeSigning({
    requestId: request.id,
    signerId: signer.id,
    submission,
    origin,
    actor: signer.name,
    verifiedBy: `One-time code by ${channel}`,
    baseUrl: esignBaseUrl(req),
    actorUserId: null,
  });
  return NextResponse.json({ status: result.status });
});
