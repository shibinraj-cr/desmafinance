import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { cleanName, FINANCE_DOCS_BLOB_PREFIX, MAX_FINANCE_DOC_BYTES } from "@/lib/finance-docs";
import { deleteFinanceBlob, headFinanceBlob, requireFinanceDocsUser } from "@/lib/finance-docs-store";

export const dynamic = "force-dynamic";

const Body = z.object({
  pathname: z.string().min(1).max(500),
  name: z.string().min(1).max(500),
  folderId: z.string().min(1).nullable(),
});

/**
 * POST /api/finance/documents — record a file the browser just uploaded.
 *
 * Size and type come from the store, not from the request: the client says
 * where it put the file, the store says what is there.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireFinanceDocsUser();
  const body = Body.parse(await req.json());

  if (!body.pathname.startsWith(FINANCE_DOCS_BLOB_PREFIX)) throw badRequest("Invalid file reference");
  const name = cleanName(body.name);
  if (!name) throw badRequest("The document needs a name");

  if (body.folderId) {
    const folder = await prisma.financeDocFolder.findUnique({ where: { id: body.folderId }, select: { id: true } });
    if (!folder) throw notFound("That folder no longer exists");
  }

  const blob = await headFinanceBlob(body.pathname);
  if (!blob) throw badRequest("The upload did not finish. Try again.");
  if (blob.size > MAX_FINANCE_DOC_BYTES) {
    await deleteFinanceBlob(body.pathname);
    throw badRequest("The file is larger than 100 MB");
  }

  const existing = await prisma.financeDocument.findUnique({ where: { blobPathname: body.pathname } });
  if (existing) return NextResponse.json({ document: existing });

  const document = await prisma.financeDocument.create({
    data: {
      name,
      folderId: body.folderId,
      blobPathname: body.pathname,
      contentType: blob.contentType,
      size: blob.size,
      uploadedById: userId,
    },
  });
  return NextResponse.json({ document });
});
