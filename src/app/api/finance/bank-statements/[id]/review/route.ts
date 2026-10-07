import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unprocessable } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { requireBank } from "@/lib/bank/access";
import { reviewStatement } from "@/lib/bank/engine";
import { BankAutomationError } from "@/lib/bank/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Schema = z.object({ action: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional() });

/**
 * POST /api/finance/bank-statements/:id/review — decide a REVIEW_REQUIRED
 * statement. Approve imports the held rows (still deduplicated); reject marks
 * it FAILED and discards them. Either way the decision is audited by user.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireBank("manage");
  const { action, note } = Schema.parse(await req.json());
  try {
    const res = await reviewStatement(params.id, action, userId, note ?? null);
    await recordAudit({ entityType: "BankStatement", entityId: params.id, action: action === "approve" ? "UPDATE" : "REJECT", userId, changes: { review: action, note, ...res } });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    if (e instanceof BankAutomationError) throw unprocessable(e.message);
    throw e;
  }
});
