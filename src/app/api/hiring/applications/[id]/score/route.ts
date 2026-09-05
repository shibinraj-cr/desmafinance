import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { scoreApplication } from "@/lib/hiring/ai/score";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/hiring/applications/[id]/score — (re)score against the job's rubric.
 *
 * Re-running after the weights change is the supported path: the stored
 * breakdown carries the weights that produced THAT score, so an old decision
 * stays readable even once the rubric has moved on.
 */
export const POST = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("candidate:write");
  const result = await scoreApplication({ applicationId: params.id, userId: access.userId });
  return NextResponse.json({ score: result });
});
