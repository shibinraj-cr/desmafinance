import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { isFinanceDocUploadPath, MAX_FINANCE_DOC_BYTES } from "@/lib/finance-docs";
import { isBlobConfigured, requireFinanceDocsUser } from "@/lib/finance-docs-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/finance/documents/upload — issue a client-upload token.
 *
 * The browser sends the file straight to the private Blob store, which is the
 * only way past Vercel's 4.5 MB request-body cap. This route decides whether it
 * may: page grant, our prefix, our size ceiling. Nothing is recorded here; the
 * browser registers the finished upload with POST /api/finance/documents,
 * which checks the blob really exists before creating the record.
 */
export const POST = withApiHandler(async (req: Request) => {
  if (!isBlobConfigured()) throw badRequest("File storage is not set up yet.", "blob_not_configured");
  const body = (await req.json()) as HandleUploadBody;

  const result = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname) => {
      await requireFinanceDocsUser();
      if (!isFinanceDocUploadPath(pathname)) throw badRequest("Invalid upload path");
      return {
        maximumSizeInBytes: MAX_FINANCE_DOC_BYTES,
        addRandomSuffix: true,
        validUntil: Date.now() + 60 * 60 * 1000,
      };
    },
  });
  return NextResponse.json(result);
});
