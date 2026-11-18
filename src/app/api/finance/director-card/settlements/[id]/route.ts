import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { CARD_PAGE, requireFloat, unmarkSettlement } from "@/lib/cash-floats-data";

export const dynamic = "force-dynamic";

/** DELETE /api/finance/director-card/settlements/:id — undo; the bank line is unexplained again. */
export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireFloat(CARD_PAGE, "act");
  await unmarkSettlement(params.id, userId);
  return NextResponse.json({ ok: true });
});
