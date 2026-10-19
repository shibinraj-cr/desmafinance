import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/http-error";
import { deleteFinanceBlob, headFinanceBlob } from "@/lib/finance-docs-store";
import { requireAgreementFilesUser } from "@/lib/esign/folders-store";
import {
  MAX_AGREEMENT_DOC_BYTES,
  agreementDocName,
  isAgreementDocType,
  isAgreementUploadPath,
} from "@/lib/esign/folders";

export const dynamic = "force-dynamic";

const Body = z.object({
  pathname: z.string().min(1).max(500),
  name: z.string().min(1).max(500),
  folderId: z.string().min(1),
});

/**
 * POST /api/esign/documents — file a document the browser just uploaded.
 *
 * Size and type come from the store, not from the request: the client says
 * where it put the file, the store says what is there. A repeat call for the
 * same upload returns the document already filed from it.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireAgreementFilesUser();
  const body = Body.parse(await req.json());
  if (!isAgreementUploadPath(body.pathname)) throw badRequest("Invalid file reference");

  const folder = await prisma.agreementFolder.findUnique({ where: { id: body.folderId }, select: { id: true } });
  if (!folder) throw notFound("That folder no longer exists");

  const existing = await prisma.agreementDocument.findUnique({ where: { blobPathname: body.pathname } });
  if (existing) return NextResponse.json({ document: existing });

  const blob = await headFinanceBlob(body.pathname);
  if (!blob) throw badRequest("The upload did not finish. Try again.");
  if (blob.size > MAX_AGREEMENT_DOC_BYTES || !isAgreementDocType(blob.contentType)) {
    await deleteFinanceBlob(body.pathname);
    throw badRequest(
      blob.size > MAX_AGREEMENT_DOC_BYTES ? "The file is larger than 50 MB" : "Only PDF, JPG or PNG files can be filed",
    );
  }

  const name = agreementDocName(body.name, blob.contentType);
  if (!name) throw badRequest("The document needs a name");

  const document = await prisma.agreementDocument.create({
    data: {
      name,
      folderId: folder.id,
      blobPathname: body.pathname,
      contentType: blob.contentType,
      size: blob.size,
      uploadedById: userId,
    },
  });
  await prisma.agreementFolder.update({ where: { id: folder.id }, data: { updatedAt: new Date() } });
  await recordAudit({
    entityType: "AgreementDocument",
    entityId: document.id,
    action: "CREATE",
    userId,
    changes: { name, folderId: folder.id, size: blob.size },
  });
  return NextResponse.json({ document });
});
