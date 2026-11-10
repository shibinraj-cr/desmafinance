import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/http-error";
import { cleanCategoryName, moveCategory } from "@/lib/esign/categories";
import { requireCategoryManager, templateCategoryNamed } from "@/lib/esign/categories-store";
import { MAX_CATEGORY_NAME_LENGTH } from "@/lib/esign/templates";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** One change per call, which is all the page ever sends. */
const Patch = z.union([
  z.object({ name: z.string().max(MAX_CATEGORY_NAME_LENGTH, `Keep the name under ${MAX_CATEGORY_NAME_LENGTH} characters`) }).strict(),
  z.object({ active: z.boolean() }).strict(),
  z.object({ move: z.enum(["up", "down"]) }).strict(),
]);

/**
 * PATCH /api/esign/categories/[id] — rename, archive / restore, or move one
 * place up or down. A rename is applied to every template in the category in
 * the same transaction; sent agreements keep the name they were sent under.
 */
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId } = await requireCategoryManager();
  const body = Patch.parse(await req.json().catch(() => null));

  const category = await prisma.esignTemplateCategory.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, active: true },
  });
  if (!category) throw notFound("That category no longer exists");

  if ("name" in body) {
    const name = cleanCategoryName(body.name);
    if (!name) throw badRequest("Give the category a name");
    if (name === category.name) return NextResponse.json({ category, templatesRenamed: 0 });
    const clash = await templateCategoryNamed(name, category.id);
    if (clash) throw conflict(`A category called "${clash.name}" already exists`, "duplicate_name");

    const [updated, templates] = await prisma.$transaction([
      prisma.esignTemplateCategory.update({
        where: { id: category.id },
        data: { name },
        select: { id: true, name: true, active: true },
      }),
      prisma.esignTemplate.updateMany({ where: { category: category.name }, data: { category: name } }),
    ]);
    await recordAudit({
      entityType: "EsignTemplateCategory",
      entityId: category.id,
      action: "UPDATE",
      userId,
      changes: { name: { from: category.name, to: name }, templatesRenamed: templates.count },
    });
    return NextResponse.json({ category: updated, templatesRenamed: templates.count });
  }

  if ("active" in body) {
    const updated = await prisma.esignTemplateCategory.update({
      where: { id: category.id },
      data: { active: body.active },
      select: { id: true, name: true, active: true },
    });
    await recordAudit({
      entityType: "EsignTemplateCategory",
      entityId: category.id,
      action: "UPDATE",
      userId,
      changes: { active: { from: category.active, to: body.active } },
    });
    return NextResponse.json({ category: updated });
  }

  // Move: renumber the whole list 0..n-1, which also tidies any gaps or ties.
  const all = await prisma.esignTemplateCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, sortOrder: true },
  });
  const order = moveCategory(
    all.map((c) => c.id),
    category.id,
    body.move,
  );
  const changed = order.flatMap((id, i) => (all.find((c) => c.id === id)?.sortOrder === i ? [] : [{ id, i }]));
  if (changed.length) {
    await prisma.$transaction(
      changed.map(({ id, i }) => prisma.esignTemplateCategory.update({ where: { id }, data: { sortOrder: i } })),
    );
  }
  return NextResponse.json({ category });
});

/**
 * DELETE /api/esign/categories/[id] — only a category no template uses, archived
 * templates included. One in use is archived instead, so its templates keep it.
 */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId } = await requireCategoryManager();
  const category = await prisma.esignTemplateCategory.findUnique({ where: { id: params.id }, select: { name: true } });
  if (!category) throw notFound("That category no longer exists");

  const inUse = await prisma.esignTemplate.count({ where: { category: category.name } });
  if (inUse) {
    throw conflict(
      `${inUse} template${inUse === 1 ? " is" : "s are"} in this category. Move ${inUse === 1 ? "it" : "them"} to another category first, or archive the category instead.`,
      "in_use",
    );
  }
  await prisma.esignTemplateCategory.delete({ where: { id: params.id } });
  await recordAudit({ entityType: "EsignTemplateCategory", entityId: params.id, action: "DELETE", userId, changes: { name: category.name } });
  return NextResponse.json({ ok: true });
});
