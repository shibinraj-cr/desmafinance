import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import {
  loadSettings,
  requireInvoiceAccess,
  saveBank,
  saveEntity,
  saveSeries,
  saveStartsOn,
  upcomingNumbers,
} from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

/** Invoice settings, with the number each series would issue next. Finance can read them. */
export const GET = withApiHandler(async () => {
  const a = await requireInvoiceAccess("finance");
  const [settings, upcoming] = await Promise.all([loadSettings(), upcomingNumbers()]);
  return NextResponse.json({ ...settings, upcoming, canManage: a.canManage });
});

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("entity"),
    code: z.string().max(10),
    legalName: z.string().max(400).optional(),
    headerLines: z.string().max(2000).optional(),
    signFor: z.string().max(400).optional(),
    thanksLine: z.string().max(400).optional(),
    gstin: z.string().max(40).nullable().optional(),
    sacCode: z.string().max(20).optional(),
    lutArn: z.string().max(80).nullable().optional(),
    note: z.string().max(1000).optional(),
    signatoryName: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("bank"),
    paymentMode: z.string().max(40),
    details: z.string().max(1000).optional(),
    isActive: z.boolean().optional(),
    entityCode: z.string().max(10).optional(),
  }),
  z.object({
    action: z.literal("series"),
    key: z.string().max(20),
    prefix: z.string().max(40).optional(),
    fyStyle: z.string().max(10).optional(),
    padding: z.number().int().optional(),
    nextNumber: z.string().max(60).nullable().optional(),
  }),
  z.object({ action: z.literal("startsOn"), value: z.string().max(10).nullable() }),
]);

/** Settings writes — Finance Manager / Admin only. */
export const POST = withApiHandler(async (req: Request) => {
  const a = await requireInvoiceAccess("manage");
  const body = Body.parse(await req.json());
  switch (body.action) {
    case "entity": {
      const { action: _a, code, ...patch } = body;
      void _a;
      await saveEntity(a, code, patch);
      break;
    }
    case "bank": {
      const { action: _a, paymentMode, ...patch } = body;
      void _a;
      await saveBank(a, paymentMode, patch);
      break;
    }
    case "series": {
      const { action: _a, key, ...patch } = body;
      void _a;
      await saveSeries(a, key, patch);
      break;
    }
    case "startsOn":
      await saveStartsOn(a, body.value);
      break;
  }
  return NextResponse.json({ ok: true });
});
