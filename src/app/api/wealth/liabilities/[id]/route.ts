import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import { requireWealthOwner } from "@/lib/wealth-access";
import { LiabilityUpdateSchema } from "@/lib/wealth-schemas";
import { syncReminders } from "@/lib/wealth";

export const dynamic = "force-dynamic";

async function ownedLiability(id: string, ownerUserId: string) {
  const row = await prisma.wealthLiability.findFirst({
    where: { id, ownerUserId },
    select: { id: true, closedAt: true },
  });
  if (!row) throw notFound();
  return row;
}

export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const ownerUserId = await requireWealthOwner();
  const existing = await ownedLiability(params.id, ownerUserId);
  const body = LiabilityUpdateSchema.parse(await req.json());

  const data: Record<string, unknown> = {};
  const set = <K extends keyof typeof body>(key: K) => {
    if (body[key] !== undefined) data[key as string] = body[key];
  };
  set("name");
  set("kind");
  set("scope");
  set("lender");
  set("principal");
  set("outstanding");
  set("interestRate");
  set("emiAmount");
  set("emiDayOfMonth");
  set("tenureMonths");
  set("notes");
  if (body.startedOn !== undefined) {
    data.startedOn = body.startedOn ? toPrismaDate(body.startedOn) : null;
  }
  // Closing keeps the row (it is history); reopening clears the stamp.
  if (body.closed !== undefined) {
    data.closedAt = body.closed ? (existing.closedAt ?? new Date()) : null;
  }

  await prisma.wealthLiability.update({ where: { id: params.id }, data });

  // Closing a loan should stop its reminders; reopening or re-dating creates them.
  if (body.closed === true) {
    await prisma.wealthReminder.deleteMany({ where: { liabilityId: params.id, status: "open" } });
  } else if (body.emiDayOfMonth !== undefined || body.closed === false) {
    await prisma.wealthReminder.deleteMany({ where: { liabilityId: params.id, status: "open" } });
    await syncReminders(ownerUserId);
  }

  return NextResponse.json({ ok: true });
});

export const DELETE = withApiHandler(
  async (_req: Request, { params }: { params: { id: string } }) => {
    const ownerUserId = await requireWealthOwner();
    await ownedLiability(params.id, ownerUserId);
    // A borrowing has no history worth keeping once it is removed by hand —
    // unlike a holding, whose valuations are the record. Hard delete, and the
    // cascade takes its reminders with it.
    await prisma.wealthLiability.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  },
);
