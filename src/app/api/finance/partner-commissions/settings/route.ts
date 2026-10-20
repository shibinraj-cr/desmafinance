import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireAccess, saveGrant, savePartner, saveProgram, saveSettings } from "@/lib/partner-commissions/server";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("settings"),
    issuerName: z.string().max(200).optional(),
    issuerAddress: z.string().max(500).optional(),
    issuerRegLine: z.string().max(300).optional(),
    bankAccountName: z.string().max(200).optional(),
    bankCurrency: z.string().max(10).optional(),
    bankIban: z.string().max(60).optional(),
    bankBic: z.string().max(30).optional(),
    bankAccountNo: z.string().max(60).optional(),
    signatoryName: z.string().max(120).optional(),
    numberPrefix: z.string().max(30).optional(),
    runDay: z.number().int().optional(),
    emailAlerts: z.boolean().optional(),
    bdePrograms: z.array(z.string().max(10)).max(10).optional(),
  }),
  z.object({
    action: z.literal("partner"),
    id: z.string().max(60).nullish(),
    name: z.string().max(200),
    address: z.string().max(500),
    email: z.string().max(200).nullish(),
    forLine: z.string().max(200).nullish(),
    layout: z.string().max(20),
    isActive: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("program"),
    code: z.string().max(10),
    partnerId: z.string().max(60),
    courseName: z.string().max(120),
    defaultFee: z.number().nullable(),
    defaultPct: z.number().nullable(),
    isActive: z.boolean().optional(),
  }),
  z.object({ action: z.literal("grant"), userId: z.string().max(60), programs: z.array(z.string().max(10)).max(10) }),
]);

/** Settings tab writes — Finance Manager / Admin only (checked in each save). */
export const POST = withApiHandler(async (req: Request) => {
  const a = await requireAccess("approve");
  const body = Body.parse(await req.json());
  switch (body.action) {
    case "settings": {
      const { action: _a, ...patch } = body;
      void _a;
      await saveSettings(a, patch);
      break;
    }
    case "partner": {
      const { action: _a, id, ...p } = body;
      void _a;
      await savePartner(a, id ?? null, p);
      break;
    }
    case "program": {
      const { action: _a, ...p } = body;
      void _a;
      await saveProgram(a, p);
      break;
    }
    case "grant":
      await saveGrant(a, body.userId, body.programs);
      break;
  }
  return NextResponse.json({ ok: true });
});
