import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { approveReceipt, requireAccess, sendBackReceipt, updateReceipt } from "@/lib/partner-commissions/server";

export const dynamic = "force-dynamic";

const Figures = {
  receivedOn: z.string().max(10).optional(),
  audSettled: z.number().optional(),
  aedAmount: z.number().optional(),
  inrAmount: z.number().optional(),
  reference: z.string().max(120).nullable().optional(),
  settleInFull: z.boolean().optional(),
  skipLedger: z.boolean().optional(),
};

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), ...Figures }),
  z.object({ action: z.literal("approve"), ...Figures }),
  z.object({ action: z.literal("send-back"), note: z.string().max(500).nullish() }),
]);

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireAccess("finance");
  const body = Body.parse(await req.json());
  if (body.action === "send-back") {
    await sendBackReceipt(a, params.id, body.note ?? null);
    return NextResponse.json({ ok: true });
  }
  const { action, ...figures } = body;
  if (action === "update") {
    await updateReceipt(a, params.id, figures);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(await approveReceipt(a, params.id, figures));
});
