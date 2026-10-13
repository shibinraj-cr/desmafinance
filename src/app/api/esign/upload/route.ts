import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { isBlobConfigured } from "@/lib/finance-docs-store";
import { requireTemplateManager } from "@/lib/esign/store";
import { MAX_TEMPLATE_PDF_BYTES, isTemplateUploadPath } from "@/lib/esign/templates";

export const dynamic = "force-dynamic";

/**
 * POST /api/esign/upload — issue a client-upload token for a template PDF.
 *
 * The browser sends the file straight to the private Blob store (the only way
 * past Vercel's 4.5 MB request cap). Nothing is recorded here: the browser
 * then registers the upload with POST /api/esign/templates (or …/versions),
 * which re-reads the stored bytes and refuses anything that is not a usable PDF.
 */
export const POST = withApiHandler(async (req: Request) => {
  if (!isBlobConfigured()) throw badRequest("File storage is not set up yet.", "blob_not_configured");
  const body = (await req.json()) as HandleUploadBody;

  const result = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname) => {
      await requireTemplateManager();
      if (!isTemplateUploadPath(pathname)) throw badRequest("Invalid upload path");
      return {
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: MAX_TEMPLATE_PDF_BYTES,
        addRandomSuffix: true,
        validUntil: Date.now() + 30 * 60 * 1000,
      };
    },
  });
  return NextResponse.json(result);
});
