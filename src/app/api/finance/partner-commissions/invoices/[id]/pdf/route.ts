import { withApiHandler } from "@/lib/api";
import { requireAccess } from "@/lib/partner-commissions/server";
import { buildInvoicePdf } from "@/lib/partner-commissions/pdf";
import { invoiceFileName, loadInvoicePdfData } from "@/lib/partner-commissions/invoice-data";

export const dynamic = "force-dynamic";

/** The invoice PDF. `?inline=1` opens it in the browser; otherwise it downloads. */
export const GET = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireAccess("finance");
  const data = await loadInvoicePdfData(params.id);
  const bytes = await buildInvoicePdf(data);
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const name = invoiceFileName(data.number);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
