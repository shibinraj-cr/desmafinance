import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { prisma } from "@/lib/prisma";
import { requireInvoiceAccess, saveEntitySignature } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

/** One company's signature image — Finance can see it, Finance Manager / Admin replace it. */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { code: string } }) => {
  await requireInvoiceAccess("finance");
  const e = await prisma.invoiceEntity.findUnique({ where: { code: params.code }, select: { signaturePng: true, signatureMime: true } });
  if (!e?.signaturePng || !e.signatureMime) throw notFound();
  return new Response(new Uint8Array(e.signaturePng), {
    headers: { "content-type": e.signatureMime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
});

export const POST = withApiHandler(async (req: Request, { params }: { params: { code: string } }) => {
  const a = await requireInvoiceAccess("manage");
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw badRequest("Choose a PNG or JPG of the signature.");
  await saveEntitySignature(a, params.code, new Uint8Array(await file.arrayBuffer()), file.type);
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { code: string } }) => {
  const a = await requireInvoiceAccess("manage");
  await saveEntitySignature(a, params.code, null, null);
  return NextResponse.json({ ok: true });
});
