import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { cleanName } from "@/lib/finance-docs";
import { addTemplateVersion, requireTemplateManager } from "@/lib/esign/store";

export const dynamic = "force-dynamic";

const VersionSchema = z.object({
  pathname: z.string().min(1).max(500),
  fileName: z.string().min(1).max(300),
  notes: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
});

/**
 * POST /api/esign/templates/[id]/versions — make a freshly uploaded PDF the
 * template's next version, carrying the current fields across.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireTemplateManager();
  const body = VersionSchema.parse(await req.json().catch(() => null));
  const result = await addTemplateVersion({
    templateId: params.id,
    userId,
    pathname: body.pathname,
    fileName: cleanName(body.fileName) ?? "template.pdf",
    notes: body.notes,
  });
  return NextResponse.json(result, { status: 201 });
});
