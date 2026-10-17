import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { publicSigner } from "@/lib/esign/public-signer";
import { sendOtp } from "@/lib/esign/signing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/sign/[token]/otp — send a one-time code by email or WhatsApp. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { token: string } }) => {
  const { request, signer, origin } = await publicSigner(req, params.token, { needSession: false, allow: ["open", "done"] });
  const { channel } = z.object({ channel: z.enum(["email", "whatsapp"]) }).parse(await req.json().catch(() => null));
  return NextResponse.json(await sendOtp(request, signer, channel, origin));
});
