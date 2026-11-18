import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireBank } from "@/lib/bank/access";
import { logEvent } from "@/lib/bank/events";
import { autoReconcile } from "@/lib/bank/reconcile-run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Schema = z.object({ integrationId: z.string().min(1).optional().nullable() });

/**
 * POST /api/finance/bank-transactions/auto-match — "Match now": match every
 * unmatched line of the last 120 days that carries an exact reference for one
 * ledger entry of exactly its amount, and pair transfers between DesGro's
 * accounts that carry the same reference on both legs. Nothing else changes.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("reconcile");
  const body = Schema.parse(await req.json().catch(() => ({})));
  const res = await autoReconcile({ integrationId: body.integrationId ?? null });
  await logEvent({
    integrationId: body.integrationId ?? null,
    step: "reconcile",
    message: `Match now: ${res.matched} matched, ${res.transfers} transfer(s) paired of ${res.examined} unmatched`,
    userId,
  });
  return NextResponse.json(res);
});
