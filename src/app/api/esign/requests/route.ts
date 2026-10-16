import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { SendInputSchema } from "@/lib/esign/requests";
import { agreementContext, saveAgreement } from "@/lib/esign/send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Stamping the PDF, storing it, then an SMTP send and a WhatsApp call.
export const maxDuration = 60;

/**
 * POST /api/esign/requests — save an agreement as a draft, or send it.
 * Returns what reached each signer, channel by channel.
 */
export const POST = withApiHandler(async (req: Request) => {
  const ctx = await agreementContext(req);
  const input = SendInputSchema.parse(await req.json().catch(() => null));
  const result = await saveAgreement(input, ctx);
  return NextResponse.json(result, { status: input.draftId ? 200 : 201 });
});
