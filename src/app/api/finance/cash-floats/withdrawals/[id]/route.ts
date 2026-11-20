import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { CASH_PAGE, requireFloat, untagWithdrawal } from "@/lib/cash-floats-data";

export const dynamic = "force-dynamic";

/** DELETE /api/finance/cash-floats/withdrawals/:id — undo a tag; the bank line is unexplained again. */
export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireFloat(CASH_PAGE, "act");
  await untagWithdrawal(params.id, userId);
  return NextResponse.json({ ok: true });
});
