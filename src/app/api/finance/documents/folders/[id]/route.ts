import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, conflict, notFound } from "@/lib/http-error";
import { cleanName } from "@/lib/finance-docs";
import { requireFinanceDocsUser, siblingNamed } from "@/lib/finance-docs-store";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const Patch = z.object({ name: z.string().min(1).max(500) });

/** PATCH /api/finance/documents/folders/[id] — rename. */
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  await requireFinanceDocsUser();
  const body = Patch.parse(await req.json());
  const name = cleanName(body.name);
  if (!name) throw badRequest("The folder needs a name");

  const folder = await prisma.financeDocFolder.findUnique({ where: { id: params.id }, select: { parentId: true } });
  if (!folder) throw notFound("That folder no longer exists");
  const clash = await siblingNamed(name, folder.parentId, params.id);
  if (clash) throw conflict(`A folder called "${clash.name}" is already here`, "duplicate_name");

  const updated = await prisma.financeDocFolder.update({ where: { id: params.id }, data: { name } });
  return NextResponse.json({ folder: updated });
});

/**
 * DELETE /api/finance/documents/folders/[id] — only an empty folder.
 *
 * Deliberately no recursive delete: one mis-click on "FY 2025-26" should not be
 * able to take a year of statements with it. Empty it first.
 */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  await requireFinanceDocsUser();
  const folder = await prisma.financeDocFolder.findUnique({
    where: { id: params.id },
    select: { _count: { select: { children: true, documents: true } } },
  });
  if (!folder) throw notFound("That folder no longer exists");
  if (folder._count.children || folder._count.documents) {
    throw conflict("Only an empty folder can be deleted. Move out or delete what is inside first.", "not_empty");
  }
  await prisma.financeDocFolder.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
