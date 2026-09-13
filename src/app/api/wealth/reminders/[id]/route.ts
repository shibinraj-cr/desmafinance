import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { toPrismaDate, todayIst } from "@/lib/lead-pulse-dates";
import { requireWealthOwner } from "@/lib/wealth-access";
import { ReminderUpdateSchema } from "@/lib/wealth-schemas";

export const dynamic = "force-dynamic";

/**
 * Settle one dated instalment: paid, skipped, or back to open.
 *
 * Marking paid does not roll the schedule forward by hand — the generator in
 * lib/wealth already holds every occurrence in the horizon, so the next one is
 * sitting there waiting. What this does is take the row out of the attention
 * rail and record what actually went out, which is rarely exactly what was
 * planned.
 */
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const ownerUserId = await requireWealthOwner();
  const body = ReminderUpdateSchema.parse(await req.json());

  const existing = await prisma.wealthReminder.findFirst({
    where: { id: params.id, ownerUserId },
    select: { id: true, amount: true },
  });
  if (!existing) throw notFound();

  const settled = body.status === "paid";
  await prisma.wealthReminder.update({
    where: { id: params.id },
    data: {
      status: body.status,
      paidOn: settled ? toPrismaDate(body.paidOn ?? todayIst()) : null,
      // Default to what was planned, so "mark paid" stays one click.
      paidAmount: settled ? (body.paidAmount ?? existing.amount ?? null) : null,
      notes: body.notes ?? undefined,
    },
  });

  return NextResponse.json({ ok: true });
});
