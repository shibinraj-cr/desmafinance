import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { requireBank } from "@/lib/bank/access";
import { logEvent } from "@/lib/bank/events";
import { setLineMatches } from "@/lib/bank/reconcile-run";

export const dynamic = "force-dynamic";

const Schema = z.object({
  // The complete set of ledger matches for this bank line (replaces any existing).
  matches: z
    .array(z.object({ transactionId: z.string().min(1), amount: z.number().positive().max(1e12) }))
    .max(50)
    .optional(),
  // Set by hand: IGNORED / MANUAL_REVIEW / UNMATCHED. Omitted → derived from the matches.
  status: z.enum(["UNMATCHED", "IGNORED", "MANUAL_REVIEW"]).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * POST /api/finance/bank-transactions/:id/reconcile — associate a bank line
 * with existing ledger Transactions (one, or several for a split), or mark it
 * IGNORED / MANUAL_REVIEW / UNMATCHED. MATCHED vs PARTIALLY_MATCHED follows
 * from the matched total. A person's decision here replaces whatever the
 * engine did, and the engine never revisits a line a person decided. Written
 * atomically under locks on the line and each picked entry (reconcile-run.ts).
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireBank("reconcile");
  const body = Schema.parse(await req.json());
  const { status, integrationId } = await setLineMatches(params.id, body, userId);
  await recordAudit({ entityType: "BankTransaction", entityId: params.id, action: "UPDATE", userId, changes: { reconciliation: status, matches: body.matches, note: body.note } });
  await logEvent({ integrationId, step: "reconcile", message: `Transaction ${params.id} marked ${status}`, userId });
  return NextResponse.json({ ok: true, status });
});
