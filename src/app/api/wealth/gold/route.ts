import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import { requireWealthOwner } from "@/lib/wealth-access";
import { GoldCreateSchema } from "@/lib/wealth-schemas";

export const dynamic = "force-dynamic";

export const POST = withApiHandler(async (req: Request) => {
  const ownerUserId = await requireWealthOwner();
  const body = GoldCreateSchema.parse(await req.json());

  const row = await prisma.wealthGoldItem.create({
    data: {
      ownerUserId,
      category: body.category,
      name: body.name,
      grams: body.grams,
      holderLabel: body.holderLabel,
      purityKarat: body.purityKarat ?? null,
      dueOn: body.dueOn ? toPrismaDate(body.dueOn) : null,
      notes: body.notes ?? null,
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
});
