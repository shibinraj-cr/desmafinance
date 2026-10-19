import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import {
  addInvoiceLine,
  cancelInvoice,
  deleteDraftInvoice,
  markInvoiceSent,
  recordReceipt,
  removeInvoiceLine,
  requireAccess,
  updateInvoice,
} from "@/lib/partner-commissions/server";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    number: z.string().max(60).optional(),
    invoiceDate: z.string().max(10).optional(),
    paymentTerm: z.string().max(60).optional(),
    billToAddress: z.string().max(500).optional(),
    billToEmail: z.string().max(200).nullable().optional(),
    billToFor: z.string().max(200).nullable().optional(),
    amountWords: z.string().max(300).nullable().optional(),
    lines: z
      .array(z.object({ id: z.string().max(60), description: z.string().max(200).optional(), commissionPct: z.number().optional() }))
      .max(500)
      .optional(),
  }),
  z.object({ action: z.literal("add-line"), enrollmentId: z.string().max(60) }),
  z.object({ action: z.literal("remove-line"), lineId: z.string().max(60) }),
  z.object({ action: z.literal("sent") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("delete") }),
  z.object({
    action: z.literal("record-payment"),
    receivedOn: z.string().max(10),
    audSettled: z.number(),
    aedAmount: z.number(),
    inrAmount: z.number(),
    reference: z.string().max(120).nullish(),
    settleInFull: z.boolean(),
    skipLedger: z.boolean().optional(),
    approveNow: z.boolean().optional(),
  }),
]);

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireAccess("finance");
  const body = Body.parse(await req.json());
  switch (body.action) {
    case "update": {
      const { action: _a, ...patch } = body;
      void _a;
      await updateInvoice(a, params.id, patch);
      return NextResponse.json({ ok: true });
    }
    case "add-line":
      await addInvoiceLine(a, params.id, body.enrollmentId);
      return NextResponse.json({ ok: true });
    case "remove-line":
      await removeInvoiceLine(a, params.id, body.lineId);
      return NextResponse.json({ ok: true });
    case "sent":
      await markInvoiceSent(a, params.id);
      return NextResponse.json({ ok: true });
    case "cancel":
      await cancelInvoice(a, params.id);
      return NextResponse.json({ ok: true });
    case "delete":
      await deleteDraftInvoice(a, params.id);
      return NextResponse.json({ ok: true });
    case "record-payment": {
      const { action: _a, approveNow, ...r } = body;
      void _a;
      const result = await recordReceipt(a, params.id, r, !!approveNow);
      return NextResponse.json(result);
    }
  }
});
