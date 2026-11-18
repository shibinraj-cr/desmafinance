import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { CARD_PAGE, requireFloat, setCardSettings } from "@/lib/cash-floats-data";

export const dynamic = "force-dynamic";

const Schema = z.object({ startOn: z.string(), payeeWords: z.string().max(300) });

/**
 * POST /api/finance/director-card/settings — the date claims count from, and
 * the words that name the director in bank narrations (kept in the database,
 * never in code).
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireFloat(CARD_PAGE, "act");
  const b = Schema.parse(await req.json());
  await setCardSettings(b.startOn, b.payeeWords, userId);
  return NextResponse.json({ ok: true });
});
