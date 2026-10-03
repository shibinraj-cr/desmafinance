import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { renamedDocumentName } from "@/lib/finance-docs";
import { deleteFinanceBlob, requireFinanceDocsUser } from "@/lib/finance-docs-store";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const Patch = z.object({ name: z.string().min(1).max(500) });

/** PATCH /api/finance/documents/[id] — rename. The stored file is untouched. */
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  await requireFinanceDocsUser();
  const body = Patch.parse(await req.json());
  const doc = await prisma.financeDocument.findUnique({ where: { id: params.id }, select: { name: true } });
  if (!doc) throw notFound("That document no longer exists");

  const name = renamedDocumentName(body.name, doc.name);
  if (!name) throw badRequest("The document needs a name");

  const document = await prisma.financeDocument.update({ where: { id: params.id }, data: { name } });
  return NextResponse.json({ document });
});

/**
 * DELETE /api/finance/documents/[id] — remove the record (and with it every
 * share link to this one file), then the stored file.
 */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  await requireFinanceDocsUser();
  const doc = await prisma.financeDocument.findUnique({ where: { id: params.id }, select: { blobPathname: true } });
  if (!doc) throw notFound("That document no longer exists");

  await prisma.financeDocument.delete({ where: { id: params.id } });
  await deleteFinanceBlob(doc.blobPathname);
  return NextResponse.json({ ok: true });
});
