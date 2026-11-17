import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { listNotInvoiced, requireInvoiceAccess } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

/** Candidate payments in a month with no invoice, for the CA: ?month=YYYY-MM */
export const GET = withApiHandler(async (req: Request) => {
  await requireInvoiceAccess("finance");
  const month = new URL(req.url).searchParams.get("month") ?? "";
  return NextResponse.json({ items: await listNotInvoiced(month) });
});
