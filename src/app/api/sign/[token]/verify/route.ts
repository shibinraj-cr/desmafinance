import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { publicSigner, setSignerSession } from "@/lib/esign/public-signer";
import { verifyOtp } from "@/lib/esign/signing";

export const dynamic = "force-dynamic";

/** POST /api/sign/[token]/verify — check the code; on success, opens a one-hour signing session. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { token: string } }) => {
  const { request, signer, origin } = await publicSigner(req, params.token, { needSession: false, allow: ["open", "done"] });
  const { code } = z.object({ code: z.string().max(12) }).parse(await req.json().catch(() => null));
  const { session } = await verifyOtp(request, signer, code, origin);
  setSignerSession(signer.id, session);
  return NextResponse.json({ ok: true });
});
