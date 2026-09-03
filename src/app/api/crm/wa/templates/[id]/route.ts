import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { prisma } from "@/lib/prisma";
import { deleteWaTemplate, updateWaTemplate } from "@/lib/wa/templates";
import { validateTemplateSpec } from "@/lib/wa/template-spec";
import { SpecSchema, specFromInput } from "@/lib/wa/template-input";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

/**
 * PATCH — edit a template and put it back in front of Meta.
 *
 * Every edit is a resubmission; there is no such thing as a quiet change to an
 * approved template. Meta re-reviews it and it can come back rejected, which is
 * why the response carries the new status rather than assuming the old one
 * survives.
 */
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!(await getCrmAccess(userId, perms)).canManageTemplates) throw forbidden();

  const existing = await prisma.waTemplate.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  const spec = specFromInput(SpecSchema.parse(await req.json().catch(() => null)));
  const { warnings } = validateTemplateSpec(spec);
  const result = await updateWaTemplate(params.id, spec, userId);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.detail ?? "The template could not be submitted.", errors: result.errors ?? [], warnings, template: result.template },
      { status: 422 },
    );
  }

  await recordAudit({
    entityType: "WaTemplate",
    entityId: params.id,
    action: "UPDATE",
    userId,
    changes: { before: { status: existing.status }, after: { status: result.template!.status, category: spec.category } },
  });

  return NextResponse.json({ template: result.template, warnings });
});

/**
 * DELETE — remove the template at Meta, then here.
 *
 * When Meta refuses, nothing is deleted locally and the reason is returned. The
 * alternative — deleting our row anyway — would leave a live template on the
 * WABA that this CRM no longer knows exists.
 */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!(await getCrmAccess(userId, perms)).canManageTemplates) throw forbidden();

  const existing = await prisma.waTemplate.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  const result = await deleteWaTemplate(params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.detail ?? "Meta would not delete that template." }, { status: 422 });
  }

  await recordAudit({
    entityType: "WaTemplate",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { name: existing.name, language: existing.language, metaId: existing.metaId },
  });

  return NextResponse.json({ ok: true });
});
