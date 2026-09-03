import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { getWaProvider } from "@/lib/wa/registry";
import { listWaTemplates, submitWaTemplate } from "@/lib/wa/templates";
import { validateTemplateSpec } from "@/lib/wa/template-spec";
import { SpecSchema, specFromInput } from "@/lib/wa/template-input";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * WhatsApp templates: author here, submitted to Meta, approved (or not) there.
 *
 * Gated on `canManageTemplates` — the same capability that governs the CRM's own
 * message templates, so a marketing supervisor can run the template catalogue
 * without being made a full CRM admin. That is a deliberate match: submitting a
 * template is an authoring act, not an administrative one, and the thing it
 * risks is a rejected review rather than candidate data.
 */
export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!(await getCrmAccess(userId, perms)).canManageTemplates) throw forbidden();

  const provider = await getWaProvider();
  const { templates, catalogueRead } = await listWaTemplates();

  return NextResponse.json({
    templates,
    // Both are reported because they fail differently and the screen has to say
    // which: without `canSubmit` a template can be drafted but never reviewed,
    // and without `catalogueRead` its status can never be confirmed.
    canSubmit: provider.supports("manageTemplates"),
    catalogueRead,
    providerLabel: provider.label,
  });
});

/**
 * POST — save a template and send it to Meta for review.
 *
 * A 202 rather than a 201, and the wording matters: nothing here has been
 * approved. Meta answers PENDING, a human decides later, and the template cannot
 * be sent to a candidate until they do.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!(await getCrmAccess(userId, perms)).canManageTemplates) throw forbidden();

  const spec = specFromInput(SpecSchema.parse(await req.json().catch(() => null)));
  const { warnings } = validateTemplateSpec(spec);
  const result = await submitWaTemplate(spec, userId);

  if (!result.ok) {
    // 422, not 400: the request was well-formed and the failure is about the
    // template's content or Meta's answer, which is what the screen shows.
    return NextResponse.json(
      { error: result.detail ?? "The template could not be submitted.", errors: result.errors ?? [], warnings, template: result.template },
      { status: 422 },
    );
  }

  await recordAudit({
    entityType: "WaTemplate",
    entityId: result.template!.id,
    action: "CREATE",
    userId,
    changes: { name: spec.name, language: spec.language, category: spec.category, status: result.template!.status },
  });

  return NextResponse.json({ template: result.template, warnings }, { status: 202 });
});
