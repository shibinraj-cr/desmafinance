import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { submitUpdate, submitDelete, type TxProposed } from "@/lib/approval";
import {
  TYPES,
  FLOWS,
  MONTHS,
  PAYMENT_MODES,
  categoriesFor,
  subItemsFor,
  flowFor,
} from "@/lib/catalog";

const MAX_BODY_BYTES = 10_000;

const TxPatchSchema = z
  .object({
    date: z
      .string()
      .min(1)
      .refine((s) => !isNaN(Date.parse(s)), "Invalid date"),
    month: z.enum(MONTHS),
    type: z.enum(TYPES),
    category: z.string().min(1).max(120),
    subItem: z.string().min(1).max(160),
    description: z.string().max(500).optional().nullable(),
    paymentMode: z.enum(PAYMENT_MODES),
    amount: z.coerce.number().positive().max(1_000_000_000),
    flow: z.enum(FLOWS).optional(),
  })
  .refine(
    (d) => (categoriesFor(d.type) as readonly string[]).includes(d.category),
    { message: "Category not allowed for this type", path: ["category"] },
  )
  .refine(
    (d) => subItemsFor(d.type, d.category).includes(d.subItem),
    { message: "Sub-item not allowed for this category", path: ["subItem"] },
  );

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if ((req.headers.get("content-type") ?? "").split(";")[0].trim() !== "application/json") {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  const body = await req.json().catch(() => null);
  const parsed = TxPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const data = parsed.data;
  const userId = session.user.id;
  const role = session.user.role ?? "executive";

  const proposed: TxProposed = {
    date: data.date,
    month: data.month,
    type: data.type,
    category: data.category,
    subItem: data.subItem,
    description: data.description ?? null,
    paymentMode: data.paymentMode,
    amount: data.amount,
    flow: data.flow ?? flowFor(data.type),
  };

  const result = await submitUpdate({ txId: params.id, data: proposed, userId, role });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if (result.applied) {
    return NextResponse.json({
      applied: true,
      item: { ...result.transaction, amount: Number(result.transaction.amount.toString()) },
    });
  }
  return NextResponse.json(
    { applied: false, pendingId: result.pending.id },
    { status: 202 },
  );
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const role = session.user.role ?? "executive";

  const result = await submitDelete({ txId: params.id, userId, role });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if (result.applied) {
    return NextResponse.json({ applied: true });
  }
  return NextResponse.json({ applied: false }, { status: 202 });
}
