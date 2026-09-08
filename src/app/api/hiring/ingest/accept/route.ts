import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { acceptItems, rejectItems } from "@/lib/hiring/ingest/accept";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  action: z.enum(["accept", "reject"]),
  itemIds: z.array(z.string().min(1)).min(1).max(200),
  /** Item ids whose proposed merge the reviewer has explicitly confirmed. */
  confirmedMerges: z.array(z.string().min(1)).max(200).optional(),
});

/**
 * POST /api/hiring/ingest/accept
 *
 * Accepting creates candidates and talent-pool rows. It never creates an
 * application — that stays a separate, deliberate act, which is what keeps the
 * funnel numbers honest.
 */
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("candidate:write");
  const body = schema.parse(await req.json());

  if (body.action === "reject") {
    return NextResponse.json({ rejected: await rejectItems(body.itemIds) });
  }

  const outcome = await acceptItems({
    itemIds: body.itemIds,
    userId: access.userId,
    confirmedMerges: body.confirmedMerges,
  });
  return NextResponse.json(outcome);
});
