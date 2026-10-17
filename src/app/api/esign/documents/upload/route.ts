import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { isBlobConfigured } from "@/lib/finance-docs-store";
import { requireAgreementFilesUser } from "@/lib/esign/folders-store";
import { ALLOWED_AGREEMENT_DOC_TYPES, MAX_AGREEMENT_DOC_BYTES, isAgreementUploadPath } from "@/lib/esign/folders";

export const dynamic = "force-dynamic";

/**
 * POST /api/esign/documents/upload — issue a client-upload token for a filed
 * agreement.
 *
 * The browser sends the file straight to the private Blob store (the only way
 * past Vercel's 4.5 MB request cap, which most scanned agreements exceed).
 * Nothing is recorded here: the browser then registers the upload with
 * POST /api/esign/documents, which checks the blob really exists first.
 */
export const POST = withApiHandler(async (req: Request) => {
  if (!isBlobConfigured()) throw badRequest("File storage is not set up yet.", "blob_not_configured");
  const body = (await req.json()) as HandleUploadBody;

  const result = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname) => {
      await requireAgreementFilesUser();
      if (!isAgreementUploadPath(pathname)) throw badRequest("Invalid upload path");
      return {
        allowedContentTypes: ALLOWED_AGREEMENT_DOC_TYPES,
        maximumSizeInBytes: MAX_AGREEMENT_DOC_BYTES,
        addRandomSuffix: true,
        validUntil: Date.now() + 60 * 60 * 1000,
      };
    },
  });
  return NextResponse.json(result);
});
