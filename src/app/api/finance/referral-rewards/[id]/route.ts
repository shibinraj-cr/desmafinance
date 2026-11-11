import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { forbidden, unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { PAYMENT_MODES } from "@/lib/catalog";
import { REFERRAL_REWARDS_PAGE } from "@/lib/crm-referral-link";
import {
  cancelReferralReward,
  payReferralReward,
  restoreReferralReward,
  undoReferralRewardPayment,
} from "@/lib/crm-referral-reward";

export const dynamic = "force-dynamic";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("pay"),
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was paid."),
    paymentMode: z.enum(PAYMENT_MODES),
    reference: z.string().trim().max(120).optional(),
  }),
  z.object({ action: z.literal("undo") }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(3, "Say why it's cancelled.").max(300) }),
  z.object({ action: z.literal("restore") }),
]);

// POST /api/finance/referral-rewards/[id] — Finance works one reward: pay it
// (which drafts the expense), take a payment back while its draft is still in
// My Drafts, cancel an unpaid one, or restore a cancelled one.
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canSeePage(perms, REFERRAL_REWARDS_PAGE)) throw forbidden();

  const body = ActionSchema.parse(await req.json().catch(() => null));
  switch (body.action) {
    case "pay": {
      const paid = await payReferralReward({
        rewardId: params.id,
        paidOn: new Date(`${body.paidOn}T00:00:00.000Z`),
        paymentMode: body.paymentMode,
        reference: body.reference || null,
        actorId: userId,
      });
      return NextResponse.json({ ok: true, ...paid });
    }
    case "undo":
      await undoReferralRewardPayment(params.id, userId);
      break;
    case "cancel":
      await cancelReferralReward(params.id, body.reason, userId);
      break;
    case "restore":
      await restoreReferralReward(params.id, userId);
      break;
  }
  return NextResponse.json({ ok: true });
});
