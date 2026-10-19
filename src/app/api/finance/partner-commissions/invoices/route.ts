import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { createInvoice, requireAccess } from "@/lib/partner-commissions/server";

export const dynamic = "force-dynamic";

const Body = z.object({
  partnerId: z.string().max(60),
  enrollmentIds: z.array(z.string().max(60)).min(1).max(500),
  invoiceDate: z.string().max(10),
  number: z.string().max(60).nullish(),
});

/** "Generate now": draft an invoice off-cycle for the enrollments Finance picked. */
export const POST = withApiHandler(async (req: Request) => {
  const a = await requireAccess("finance");
  const body = Body.parse(await req.json());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.invoiceDate)) throw badRequest("Pick the invoice date.");
  const inv = await createInvoice({ ...body, source: "manual", userId: a.userId });
  return NextResponse.json({ id: inv.id, number: inv.number });
});
