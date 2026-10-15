import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { agreementContext, updateSignerContact } from "@/lib/esign/send";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

/** PATCH /api/esign/requests/[id]/signers/[signerId] — correct a signer's contact details (logged). */
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string; signerId: string } }) => {
  const ctx = await agreementContext(req);
  await updateSignerContact(params.id, params.signerId, Patch.parse(await req.json().catch(() => null)), ctx);
  return NextResponse.json({ ok: true });
});
