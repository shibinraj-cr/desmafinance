import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { internalSigner } from "@/lib/esign/internal-signer";
import { declineSigning } from "@/lib/esign/signing";

export const dynamic = "force-dynamic";

/** POST /api/esign/requests/[id]/sign/decline — DESMA staff decline to sign, with a reason. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { request, signer, user, origin } = await internalSigner(req, params.id);
  const { reason } = z.object({ reason: z.string().max(1000) }).parse(await req.json().catch(() => null));
  await declineSigning({ requestId: request.id, signerId: signer.id, reason, origin, actor: user?.email ?? signer.name });
  return NextResponse.json({ ok: true });
});
