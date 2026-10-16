import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { agreementContext, resendLink } from "@/lib/esign/send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/esign/requests/[id]/resend — a fresh link for one signer; the old one stops working. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await agreementContext(req);
  const { signerId } = z.object({ signerId: z.string().min(1) }).parse(await req.json().catch(() => null));
  const delivery = await resendLink(params.id, signerId, ctx);
  return NextResponse.json({ delivery });
});
