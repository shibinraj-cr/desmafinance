import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { CASH_PAGE, deleteVoucher, requireFloat } from "@/lib/cash-floats-data";

export const dynamic = "force-dynamic";

/** DELETE /api/finance/cash-floats/vouchers/:id — remove a voucher uploaded by mistake. */
export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireFloat(CASH_PAGE, "act");
  await deleteVoucher(params.id, userId);
  return NextResponse.json({ ok: true });
});
