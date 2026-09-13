import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { conflict, forbidden, notFound } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { CategoryPatchSchema } from "@/lib/sop/schemas";
import { isUniqueViolation } from "@/lib/sop/workflow";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  if (!access.canManageCategories) throw forbidden();

  const existing = await prisma.sopCategory.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound("Category not found.");

  const d = CategoryPatchSchema.parse(await req.json().catch(() => null));
  try {
    const updated = await prisma.sopCategory.update({ where: { id: params.id }, data: d });
    return NextResponse.json({ category: updated });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A category with that name already exists.", "name_taken");
    throw e;
  }
});

/**
 * DELETE — retire a category.
 *
 * A category still in use is DEACTIVATED rather than deleted: removing it
 * outright would either orphan the SOPs classified under it or silently
 * reclassify them. Deactivating drops it from the picker and leaves history
 * legible.
 */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  if (!access.canManageCategories) throw forbidden();

  const existing = await prisma.sopCategory.findUnique({
    where: { id: params.id },
    include: { _count: { select: { sops: true, versions: true } } },
  });
  if (!existing) throw notFound("Category not found.");

  if (existing._count.sops > 0 || existing._count.versions > 0) {
    const updated = await prisma.sopCategory.update({
      where: { id: params.id },
      data: { isActive: false },
    });
    return NextResponse.json({ category: updated, deactivated: true });
  }

  await prisma.sopCategory.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true, deleted: true });
});
