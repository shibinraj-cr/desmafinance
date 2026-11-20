import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { CARD_PAGE, markSettlement, requireFloat } from "@/lib/cash-floats-data";

export const dynamic = "force-dynamic";

const Schema = z.object({ bankTransactionId: z.string().min(1), note: z.string().trim().max(300).optional().nullable() });

/**
 * POST /api/finance/director-card/settlements — a bank payment to the director
 * repays card claims (oldest first). Never a second expense.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireFloat(CARD_PAGE, "act");
  const b = Schema.parse(await req.json());
  const s = await markSettlement(b.bankTransactionId, b.note ?? null, userId);
  return NextResponse.json({ id: s.id });
});
