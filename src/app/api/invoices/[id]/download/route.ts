import { withApiHandler } from "@/lib/api";
import { unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { invoiceDownload } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

/**
 * Download an issued invoice: the stored file, exactly as issued (or its
 * CANCELLED copy). Finance, the candidate's BDE, CRM supervisors and the
 * candidate's Ops person may download; every download is logged.
 */
export const GET = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const { bytes, filename } = await invoiceDownload(userId, perms, params.id);
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
