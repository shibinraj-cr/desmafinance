import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { cleanName } from "@/lib/finance-docs";
import { cloneTemplate, requireTemplateManager } from "@/lib/esign/store";

export const dynamic = "force-dynamic";

const CloneSchema = z.object({ name: z.string().max(200).nullable().optional() }).nullable();

/** POST /api/esign/templates/[id]/clone — copy settings, current PDF and fields. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireTemplateManager();
  const body = CloneSchema.parse(await req.json().catch(() => null));
  const name = body?.name ? cleanName(body.name) : null;
  const { templateId } = await cloneTemplate({ sourceId: params.id, userId, name });
  return NextResponse.json({ template: { id: templateId } }, { status: 201 });
});
