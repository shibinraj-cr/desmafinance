import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import { requireWealthOwner } from "@/lib/wealth-access";
import { GoldUpdateSchema } from "@/lib/wealth-schemas";

export const dynamic = "force-dynamic";

async function ownedGoldItem(id: string, ownerUserId: string) {
  const row = await prisma.wealthGoldItem.findFirst({
    where: { id, ownerUserId, archivedAt: null },
    select: { id: true },
  });
  if (!row) throw notFound();
  return row;
}

export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const ownerUserId = await requireWealthOwner();
  await ownedGoldItem(params.id, ownerUserId);
  const body = GoldUpdateSchema.parse(await req.json());

  const data: Record<string, unknown> = {};
  const set = <K extends keyof typeof body>(key: K) => {
    if (body[key] !== undefined) data[key as string] = body[key];
  };
  set("category");
  set("name");
  set("grams");
  set("holderLabel");
  set("purityKarat");
  set("notes");
  if (body.dueOn !== undefined) data.dueOn = body.dueOn ? toPrismaDate(body.dueOn) : null;

  await prisma.wealthGoldItem.update({ where: { id: params.id }, data });
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiHandler(
  async (_req: Request, { params }: { params: { id: string } }) => {
    const ownerUserId = await requireWealthOwner();
    await ownedGoldItem(params.id, ownerUserId);
    // Archive rather than delete: a piece that left the vault (sold, gifted)
    // should stop counting without erasing that it was ever there.
    await prisma.wealthGoldItem.update({
      where: { id: params.id },
      data: { archivedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  },
);
