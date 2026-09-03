import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { parseResume } from "@/lib/hiring/ai/resume-parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("candidate:write");
  const result = await parseResume({ candidateId: params.id, userId: access.userId });
  return NextResponse.json(result);
});
