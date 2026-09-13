import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import { requireWealthOwner } from "@/lib/wealth-access";
import { LiabilityCreateSchema } from "@/lib/wealth-schemas";
import { syncReminders } from "@/lib/wealth";

export const dynamic = "force-dynamic";

export const POST = withApiHandler(async (req: Request) => {
  const ownerUserId = await requireWealthOwner();
  const body = LiabilityCreateSchema.parse(await req.json());

  const row = await prisma.wealthLiability.create({
    data: {
      ownerUserId,
      name: body.name,
      kind: body.kind,
      scope: body.scope,
      lender: body.lender ?? null,
      principal: body.principal ?? null,
      outstanding: body.outstanding,
      interestRate: body.interestRate ?? null,
      emiAmount: body.emiAmount ?? null,
      emiDayOfMonth: body.emiDayOfMonth ?? null,
      startedOn: body.startedOn ? toPrismaDate(body.startedOn) : null,
      tenureMonths: body.tenureMonths ?? null,
      notes: body.notes ?? null,
      closedAt: body.closed ? new Date() : null,
    },
    select: { id: true },
  });

  // An EMI day means dated instalments to remind about.
  if (body.emiDayOfMonth) await syncReminders(ownerUserId);

  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
});
