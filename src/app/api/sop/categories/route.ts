import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { conflict, forbidden } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { CategorySchema } from "@/lib/sop/schemas";
import { isUniqueViolation } from "@/lib/sop/workflow";

export const dynamic = "force-dynamic";

/** GET — the category master. Readable by anyone in the module (it fills a picker). */
export const GET = withApiHandler(async (req: Request) => {
  await requireSopAccess();
  const includeInactive = new URL(req.url).searchParams.get("all") === "1";
  const categories = await prisma.sopCategory.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { sops: true } } },
  });
  return NextResponse.json({ categories });
});

/** POST — add a category (SOP admins). */
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireSopAccess();
  if (!access.canManageCategories) throw forbidden();

  const d = CategorySchema.parse(await req.json().catch(() => null));
  try {
    const created = await prisma.sopCategory.create({
      data: {
        name: d.name,
        description: d.description ?? null,
        sortOrder: d.sortOrder,
        isActive: d.isActive,
      },
    });
    return NextResponse.json({ category: created }, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A category with that name already exists.", "name_taken");
    throw e;
  }
});
