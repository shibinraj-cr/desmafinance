import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { correctInvoiceNumber, requireInvoiceAccess } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";
// Rebuilds the stored PDF; next.config.mjs traces the logo and font into this route.
export const runtime = "nodejs";

const Body = z.object({ number: z.string().max(40), reason: z.string().max(400) });

/** Correct an issued invoice's number — Finance Manager / Admin, before its month's GSTR-1 falls due. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireInvoiceAccess("manage");
  const { number, reason } = Body.parse(await req.json());
  const res = await correctInvoiceNumber(a, params.id, number, reason);
  return NextResponse.json(res);
});
