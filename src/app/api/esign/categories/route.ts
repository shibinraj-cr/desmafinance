import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { badRequest, conflict } from "@/lib/http-error";
import { cleanCategoryName } from "@/lib/esign/categories";
import { requireCategoryManager, templateCategoryNamed } from "@/lib/esign/categories-store";
import { MAX_CATEGORY_NAME_LENGTH } from "@/lib/esign/templates";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().max(MAX_CATEGORY_NAME_LENGTH, `Keep the name under ${MAX_CATEGORY_NAME_LENGTH} characters`) });

/** POST /api/esign/categories — add a category at the end of the list. */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireCategoryManager();
  const body = Body.parse(await req.json().catch(() => null));
  const name = cleanCategoryName(body.name);
  if (!name) throw badRequest("Give the category a name");

  const clash = await templateCategoryNamed(name);
  if (clash) throw conflict(`A category called "${clash.name}" already exists`, "duplicate_name");

  const last = await prisma.esignTemplateCategory.aggregate({ _max: { sortOrder: true } });
  const category = await prisma.esignTemplateCategory.create({
    data: { name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    select: { id: true, name: true, active: true },
  });
  await recordAudit({ entityType: "EsignTemplateCategory", entityId: category.id, action: "CREATE", userId, changes: { name } });
  return NextResponse.json({ category }, { status: 201 });
});
