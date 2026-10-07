import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireBank } from "@/lib/bank/access";
import { createRun } from "@/lib/bank/engine";
import { continueInBackground } from "@/lib/bank/kick";

export const dynamic = "force-dynamic";
// The run continues after the response (waitUntil) for up to this long.
export const maxDuration = 300;

const Schema = z.object({ integrationId: z.string().min(1) });

/**
 * POST /api/finance/bank-automation/run — "Run Now". Queues a MANUAL run and
 * returns at once with its id; the work continues in the background and the
 * UI polls GET …/runs/:id. If a run is already going, that one is returned.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const { integrationId } = Schema.parse(await req.json());
  const { runId, existing } = await createRun({ integrationId, trigger: "MANUAL", userId });
  continueInBackground(runId);
  return NextResponse.json({ runId, existing }, { status: 202 });
});
