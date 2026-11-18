import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireBank } from "@/lib/bank/access";
import { pairTransfer, unpairTransfer } from "@/lib/bank/reconcile-run";

export const dynamic = "force-dynamic";

const Schema = z.object({ pairWith: z.string().min(1) });

/** POST /api/finance/bank-transactions/:id/transfer — pair this line with the other leg of a transfer between DesGro's accounts. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireBank("reconcile");
  const { pairWith } = Schema.parse(await req.json());
  await pairTransfer(params.id, pairWith, userId);
  return NextResponse.json({ ok: true });
});

/** DELETE — undo the pairing; both legs go back to unmatched. */
export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireBank("reconcile");
  await unpairTransfer(params.id, userId);
  return NextResponse.json({ ok: true });
});
