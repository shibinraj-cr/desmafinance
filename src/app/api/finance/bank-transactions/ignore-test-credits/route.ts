import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireBank } from "@/lib/bank/access";
import { ignoreTestCredits } from "@/lib/bank/reconcile-run";

export const dynamic = "force-dynamic";

const Schema = z.object({ integrationId: z.string().min(1).optional().nullable() });

/** POST /api/finance/bank-transactions/ignore-test-credits — set aside every unmatched ₹1–₹10 credit. */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("reconcile");
  const body = Schema.parse(await req.json().catch(() => ({})));
  const ignored = await ignoreTestCredits(userId, body.integrationId ?? null);
  return NextResponse.json({ ignored });
});
