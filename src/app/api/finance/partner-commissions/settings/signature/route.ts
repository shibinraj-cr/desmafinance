import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { getSettings, requireAccess, saveSignature } from "@/lib/partner-commissions/server";

export const dynamic = "force-dynamic";

/** The signature image printed on invoices — Finance can see it, Finance Manager / Admin replace it. */
export const GET = withApiHandler(async () => {
  await requireAccess("finance");
  const s = await getSettings();
  if (!s.signaturePng || !s.signatureMime) throw notFound();
  return new Response(new Uint8Array(s.signaturePng), {
    headers: { "content-type": s.signatureMime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
});

export const POST = withApiHandler(async (req: Request) => {
  const a = await requireAccess("approve");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a PNG or JPG of the signature.");
  await saveSignature(a, new Uint8Array(await file.arrayBuffer()), file.type);
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiHandler(async () => {
  const a = await requireAccess("approve");
  await saveSignature(a, null, null);
  return NextResponse.json({ ok: true });
});
