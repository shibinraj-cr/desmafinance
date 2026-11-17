import { withApiHandler } from "@/lib/api";
import { previewInvoice, requireInvoiceAccess } from "@/lib/invoices/server";
import { IssueBody, toIssueInput } from "../_schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The PDF the Issue form would produce, stamped PREVIEW. Nothing is saved. */
export const POST = withApiHandler(async (req: Request) => {
  await requireInvoiceAccess("finance");
  const body = IssueBody.parse(await req.json());
  const { pdf } = await previewInvoice(toIssueInput(body));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="invoice-preview.pdf"',
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
