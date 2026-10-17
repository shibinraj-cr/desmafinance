import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { publicSigner } from "@/lib/esign/public-signer";
import { declineSigning } from "@/lib/esign/signing";

export const dynamic = "force-dynamic";

/** POST /api/sign/[token]/decline — decline to sign, with a reason. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { token: string } }) => {
  const { request, signer, origin } = await publicSigner(req, params.token, { needSession: true });
  const { reason } = z.object({ reason: z.string().max(1000) }).parse(await req.json().catch(() => null));
  await declineSigning({ requestId: request.id, signerId: signer.id, reason, origin, actor: signer.name });
  return NextResponse.json({ ok: true });
});
