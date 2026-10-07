import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireBank } from "@/lib/bank/access";
import { retryStatements } from "@/lib/bank/engine";
import { continueInBackground } from "@/lib/bank/kick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Schema = z.object({
  integrationId: z.string().min(1),
  // A list of statements, or "failed" for every FAILED / MANUAL_ACTION_REQUIRED one.
  statementIds: z.union([z.array(z.string().min(1)).min(1).max(200), z.literal("failed")]),
});

/** POST /api/finance/bank-statements/retry — "Retry" / "Retry Failed". */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const { integrationId, statementIds } = Schema.parse(await req.json());
  const { runId, count } = await retryStatements(integrationId, statementIds, userId);
  if (runId) continueInBackground(runId);
  return NextResponse.json({ runId, count }, { status: 202 });
});
