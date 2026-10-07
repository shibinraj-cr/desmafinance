import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireBank } from "@/lib/bank/access";
import { createRun } from "@/lib/bank/engine";
import { continueInBackground } from "@/lib/bank/kick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Schema = z.object({ integrationId: z.string().min(1) });

/**
 * POST /api/finance/bank-automation/test-statement-access — the full
 * connection test (Gmail → latest e-mail → link → bank page → PDF → parse →
 * preview). Preview only: it writes no statement, no transactions, no PDF.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const { integrationId } = Schema.parse(await req.json());
  const { runId } = await createRun({ integrationId, trigger: "TEST", userId });
  continueInBackground(runId);
  return NextResponse.json({ runId }, { status: 202 });
});
