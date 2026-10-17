import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/http-error";
import { cleanName } from "@/lib/finance-docs";
import {
  agreementFolderNamed,
  requireAgreementFilesAdmin,
  requireAgreementFilesUser,
} from "@/lib/esign/folders-store";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const Patch = z.object({ name: z.string().min(1).max(500) });

/** PATCH /api/esign/folders/[id] — rename. */
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId } = await requireAgreementFilesUser();
  const body = Patch.parse(await req.json());
  const name = cleanName(body.name);
  if (!name) throw badRequest("The folder needs a name");

  const folder = await prisma.agreementFolder.findUnique({ where: { id: params.id }, select: { name: true } });
  if (!folder) throw notFound("That folder no longer exists");
  const clash = await agreementFolderNamed(name, params.id);
  if (clash) throw conflict(`A folder called "${clash.name}" already exists`, "duplicate_name");

  const updated = await prisma.agreementFolder.update({ where: { id: params.id }, data: { name } });
  await recordAudit({
    entityType: "AgreementFolder",
    entityId: params.id,
    action: "UPDATE",
    userId,
    changes: { name: { from: folder.name, to: name } },
  });
  return NextResponse.json({ folder: updated });
});

/**
 * DELETE /api/esign/folders/[id] — admins only, and only an empty folder.
 * Deliberately no recursive delete: one mis-click should not be able to take
 * a whole archive of signed agreements with it.
 */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId } = await requireAgreementFilesAdmin();
  const folder = await prisma.agreementFolder.findUnique({
    where: { id: params.id },
    select: { name: true, _count: { select: { documents: true } } },
  });
  if (!folder) throw notFound("That folder no longer exists");
  if (folder._count.documents) {
    throw conflict("Only an empty folder can be deleted. Delete what is inside first.", "not_empty");
  }
  await prisma.agreementFolder.delete({ where: { id: params.id } });
  await recordAudit({ entityType: "AgreementFolder", entityId: params.id, action: "DELETE", userId, changes: { name: folder.name } });
  return NextResponse.json({ ok: true });
});
