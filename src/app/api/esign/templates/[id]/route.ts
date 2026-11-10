import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/http-error";
import { cleanName } from "@/lib/finance-docs";
import { requireTemplateManager } from "@/lib/esign/store";
import { requireActiveCategory } from "@/lib/esign/categories-store";
import { TemplateSettingsSchema } from "@/lib/esign/templates";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/**
 * PATCH /api/esign/templates/[id] — change a template's settings, or archive /
 * restore it (`active`). Templates are never deleted: sent agreements keep
 * pointing at their versions. An archived template only accepts a restore.
 */
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId } = await requireTemplateManager();
  const body = TemplateSettingsSchema.parse(await req.json().catch(() => null));

  const template = await prisma.esignTemplate.findUnique({
    where: { id: params.id },
    select: { active: true, category: true },
  });
  if (!template) throw notFound("That template no longer exists.");

  const { active, name: rawName, category: rawCategory, ...rest } = body;
  const settings: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  const name = rawName === undefined ? undefined : cleanName(rawName);
  if (rawName !== undefined && !name) throw badRequest("Give the template a name");
  // The settings form always sends the category, so re-sending the template's
  // own one is no change — even when that category has since been archived.
  const changesCategory = rawCategory !== undefined && rawCategory !== template.category;
  const changesSettings = name !== undefined || changesCategory || Object.keys(settings).length > 0;
  if (!template.active && active !== true && changesSettings) {
    throw conflict("This template is archived. Restore it before changing it.", "archived");
  }
  if (changesCategory && rawCategory !== undefined) settings.category = await requireActiveCategory(rawCategory);

  const updated = await prisma.esignTemplate.update({
    where: { id: params.id },
    data: { ...settings, ...(name ? { name } : {}), ...(active === undefined ? {} : { active }) },
    select: { id: true, active: true, updatedAt: true },
  });
  await recordAudit({
    entityType: "EsignTemplate",
    entityId: params.id,
    action: "UPDATE",
    userId,
    changes: { ...settings, ...(name ? { name } : {}), ...(active === undefined ? {} : { active }) },
  });
  return NextResponse.json({ template: { ...updated, updatedAt: updated.updatedAt.toISOString() } });
});
