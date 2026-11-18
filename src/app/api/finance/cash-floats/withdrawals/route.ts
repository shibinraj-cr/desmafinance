import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { CASH_PAGE, requireFloat, tagWithdrawal } from "@/lib/cash-floats-data";
import { CASH_KINDS } from "@/lib/cash-floats";

export const dynamic = "force-dynamic";

const Schema = z.object({
  bankTransactionId: z.string().min(1),
  kind: z.enum(CASH_KINDS),
  heldBy: z.string().trim().max(80).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});

/**
 * POST /api/finance/cash-floats/withdrawals — tag a bank debit as cash into
 * the Outdoor Marketing or Petty Cash float. Not an expense, not an outflow.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireFloat(CASH_PAGE, "act");
  const b = Schema.parse(await req.json());
  const w = await tagWithdrawal(b.bankTransactionId, b.kind, { heldBy: b.heldBy, note: b.note }, userId);
  return NextResponse.json({ id: w.id });
});
