import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { moveApplication } from "@/lib/hiring/pipeline";

export const dynamic = "force-dynamic";

const schema = z.object({
  toStageId: z.string().min(1),
  reason: z.string().trim().max(500).nullable().optional(),
});

/**
 * POST /api/hiring/applications/[id]/move
 *
 * `candidate:move` is its own permission key precisely so that reading a
 * pipeline and CHANGING one are separable — an interviewer who can see the
 * board should not be able to advance people through it by accident.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("candidate:move");
  const body = schema.parse(await req.json());

  const result = await moveApplication({
    applicationId: params.id,
    toStageId: body.toStageId,
    actorId: access.userId,
    reason: body.reason ?? null,
  });

  return NextResponse.json({ move: result });
});
