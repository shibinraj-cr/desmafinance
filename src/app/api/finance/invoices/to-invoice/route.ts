import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { listToInvoice, requireInvoiceAccess } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

/** Approved payments into an invoicing bank that still need an invoice. */
export const GET = withApiHandler(async () => {
  await requireInvoiceAccess("finance");
  return NextResponse.json(await listToInvoice());
});
