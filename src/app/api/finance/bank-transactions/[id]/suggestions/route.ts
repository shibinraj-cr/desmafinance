import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { requireBank } from "@/lib/bank/access";
import { lineSuggestions } from "@/lib/bank/reconcile-run";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/bank-transactions/:id/suggestions — what this line probably
 * is: scored ledger entries (with the reasons), the other leg of a transfer
 * between DesGro's accounts, and how the same kind of line was booked before.
 */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireBank("reconcile");
  return NextResponse.json(await lineSuggestions(params.id));
});
