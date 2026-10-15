import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { cleanName } from "@/lib/finance-docs";
import { createTemplateFromUpload, requireTemplateManager } from "@/lib/esign/store";
import { TEMPLATE_CATEGORIES, TemplateSettingsSchema } from "@/lib/esign/templates";

export const dynamic = "force-dynamic";

const CreateSchema = TemplateSettingsSchema.extend({
  name: z.string().trim().min(1, "Give the template a name").max(200),
  category: z.enum(TEMPLATE_CATEGORIES),
  pathname: z.string().min(1).max(500),
  fileName: z.string().min(1).max(300),
});

/**
 * POST /api/esign/templates — create a template from a PDF the browser has
 * just uploaded through /api/esign/upload. Returns the new template's id; the
 * caller goes on to the field builder.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireTemplateManager();
  const body = CreateSchema.parse(await req.json().catch(() => null));
  const name = cleanName(body.name);
  if (!name) throw badRequest("Give the template a name");

  const { templateId, created } = await createTemplateFromUpload({
    userId,
    pathname: body.pathname,
    fileName: cleanName(body.fileName) ?? "template.pdf",
    settings: {
      name,
      category: body.category,
      description: body.description ?? null,
      defaultExpiryDays: body.defaultExpiryDays,
      defaultReminderDays: body.defaultReminderDays,
      emailSubject: body.emailSubject,
      emailBody: body.emailBody,
      whatsappTemplateName: body.whatsappTemplateName,
    },
  });
  return NextResponse.json({ template: { id: templateId } }, { status: created ? 201 : 200 });
});
