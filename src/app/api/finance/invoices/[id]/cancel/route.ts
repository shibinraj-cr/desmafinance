import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { cancelInvoice, requireInvoiceAccess } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

const Body = z.object({ reason: z.string().max(400) });

/** Cancel an issued invoice — Finance Manager / Admin. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireInvoiceAccess("manage");
  const { reason } = Body.parse(await req.json());
  await cancelInvoice(a, params.id, reason);
  return NextResponse.json({ ok: true });
});
