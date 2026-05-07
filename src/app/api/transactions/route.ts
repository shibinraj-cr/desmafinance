import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TYPES, FLOWS, MONTHS, PAYMENT_MODES, flowFor } from "@/lib/catalog";

const TxSchema = z.object({
  date: z.string().min(1),
  month: z.enum(MONTHS),
  type: z.enum(TYPES),
  category: z.string().min(1).max(120),
  subItem: z.string().min(1).max(160),
  description: z.string().max(500).optional().nullable(),
  paymentMode: z.string().min(1).max(60),
  amount: z.coerce.number().positive().max(1_000_000_000),
  flow: z.enum(FLOWS).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? undefined;
  const type = searchParams.get("type") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 1000);

  const items = await prisma.transaction.findMany({
    where: {
      ...(month ? { month } : {}),
      ...(type ? { type } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  return NextResponse.json({
    items: items.map((t) => ({
      ...t,
      amount: Number(t.amount.toString()),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = TxSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const userId = (session.user as { id?: string }).id;

  const created = await prisma.transaction.create({
    data: {
      date: new Date(data.date),
      month: data.month,
      type: data.type,
      category: data.category,
      subItem: data.subItem,
      description: data.description ?? null,
      paymentMode: data.paymentMode,
      amount: data.amount,
      flow: data.flow ?? flowFor(data.type),
      createdById: userId ?? null,
    },
  });

  return NextResponse.json({
    item: { ...created, amount: Number(created.amount.toString()) },
  });
}
