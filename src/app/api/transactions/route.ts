import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitCreate, type TxProposed } from "@/lib/approval";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
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

const TxSchema = z
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

const QuerySchema = z.object({
  month: z.enum(MONTHS).optional(),
  type: z.enum(TYPES).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const parsedQ = QuerySchema.safeParse({
    month: searchParams.get("month") ?? undefined,
    type: searchParams.get("type") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  if (!parsedQ.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }
  const { month, type, limit } = parsedQ.data;

  const items = await prisma.transaction.findMany({
    where: {
      deletedAt: null,
      ...(month ? { month } : {}),
      ...(type ? { type } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  return NextResponse.json({
    items: items.map((t) => ({ ...t, amount: Number(t.amount.toString()) })),
  });
}

export async function POST(req: NextRequest) {
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
  const parsed = TxSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const data = parsed.data;
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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

  const result = await submitCreate({ data: proposed, userId, perms });
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
