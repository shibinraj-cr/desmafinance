import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { CASH_PAGE, requireFloat, setFloatStart } from "@/lib/cash-floats-data";
import { CASH_KINDS } from "@/lib/cash-floats";

export const dynamic = "force-dynamic";

const Schema = z.object({ kind: z.enum(CASH_KINDS), on: z.string(), balance: z.coerce.number() });

/** POST /api/finance/cash-floats/settings — where a float's statement starts, and the cash in hand that day. */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireFloat(CASH_PAGE, "act");
  const b = Schema.parse(await req.json());
  await setFloatStart(b.kind, b.on, b.balance, userId);
  return NextResponse.json({ ok: true });
});
