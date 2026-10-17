import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/http-error";
import { renamedDocumentName } from "@/lib/finance-docs";
import { deleteFinanceBlob } from "@/lib/finance-docs-store";
import { requireAgreementFilesAdmin, requireAgreementFilesUser } from "@/lib/esign/folders-store";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const Patch = z.object({ name: z.string().min(1).max(500) });

/** PATCH /api/esign/documents/[id] — rename. The stored file is untouched. */
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId } = await requireAgreementFilesUser();
  const body = Patch.parse(await req.json());
  const doc = await prisma.agreementDocument.findUnique({ where: { id: params.id }, select: { name: true } });
  if (!doc) throw notFound("That document no longer exists");

  const name = renamedDocumentName(body.name, doc.name);
  if (!name) throw badRequest("The document needs a name");

  const document = await prisma.agreementDocument.update({ where: { id: params.id }, data: { name } });
  await recordAudit({
    entityType: "AgreementDocument",
    entityId: params.id,
    action: "UPDATE",
    userId,
    changes: { name: { from: doc.name, to: name } },
  });
  return NextResponse.json({ document });
});

/** DELETE /api/esign/documents/[id] — admins only; removes the record, then the stored file. */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId } = await requireAgreementFilesAdmin();
  const doc = await prisma.agreementDocument.findUnique({
    where: { id: params.id },
    select: { name: true, folderId: true, size: true, blobPathname: true },
  });
  if (!doc) throw notFound("That document no longer exists");

  await prisma.agreementDocument.delete({ where: { id: params.id } });
  await deleteFinanceBlob(doc.blobPathname);
  await recordAudit({
    entityType: "AgreementDocument",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { name: doc.name, folderId: doc.folderId, size: doc.size },
  });
  return NextResponse.json({ ok: true });
});
