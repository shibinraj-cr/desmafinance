import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { issueInvoice, listInvoices, requireInvoiceAccess } from "@/lib/invoices/server";
import { IssueBody, toIssueInput } from "./_schema";

export const dynamic = "force-dynamic";
// Issuing renders the PDF; next.config.mjs traces the logo and font into this route.
export const runtime = "nodejs";

/** The invoice register: ?month=YYYY-MM&series=DIPL-DOM&status=issued&q=… */
export const GET = withApiHandler(async (req: Request) => {
  await requireInvoiceAccess("finance");
  const u = new URL(req.url).searchParams;
  const items = await listInvoices({ month: u.get("month"), series: u.get("series"), status: u.get("status"), q: u.get("q") });
  return NextResponse.json({ items });
});

/** Issue the invoice for one approved payment. */
export const POST = withApiHandler(async (req: Request) => {
  const a = await requireInvoiceAccess("finance");
  const body = IssueBody.parse(await req.json());
  const res = await issueInvoice(a, toIssueInput(body));
  return NextResponse.json(res, { status: 201 });
});
