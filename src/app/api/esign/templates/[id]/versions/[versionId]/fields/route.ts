import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireTemplateManager, saveVersionFields } from "@/lib/esign/store";
import { FieldListSchema } from "@/lib/esign/template-fields";

export const dynamic = "force-dynamic";

const SaveSchema = z.object({
  fields: FieldListSchema,
  /** The template's updatedAt when the builder loaded, to catch a concurrent save. */
  expectedUpdatedAt: z.string().datetime().nullable(),
});

type Ctx = { params: { id: string; versionId: string } };

/**
 * PUT /api/esign/templates/[id]/versions/[versionId]/fields — replace the
 * layout. If agreements were already sent from this version the save becomes
 * a new version instead; the response says which (`forked`).
 */
export const PUT = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId } = await requireTemplateManager();
  const body = SaveSchema.parse(await req.json().catch(() => null));
  const result = await saveVersionFields({
    templateId: params.id,
    versionId: params.versionId,
    userId,
    fields: body.fields,
    expectedUpdatedAt: body.expectedUpdatedAt,
  });
  return NextResponse.json(result);
});
