import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { requireInvoiceAccess, upcomingNumber } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

/** ?series=DIPL-DOM&date=YYYY-MM-DD → the number an invoice issued now would get. */
export const GET = withApiHandler(async (req: Request) => {
  await requireInvoiceAccess("finance");
  const u = new URL(req.url).searchParams;
  const number = await upcomingNumber(u.get("series") ?? "", u.get("date") ?? "");
  return NextResponse.json({ number }, { headers: { "cache-control": "private, no-store" } });
});
