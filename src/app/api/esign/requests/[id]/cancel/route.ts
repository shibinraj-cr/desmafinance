import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { agreementContext, cancelAgreement } from "@/lib/esign/send";

export const dynamic = "force-dynamic";

/** POST /api/esign/requests/[id]/cancel — cancel an agreement (or discard a draft), with a reason. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await agreementContext(req);
  const { reason } = z.object({ reason: z.string().max(500) }).parse(await req.json().catch(() => null));
  await cancelAgreement(params.id, reason, ctx);
  return NextResponse.json({ ok: true });
});
