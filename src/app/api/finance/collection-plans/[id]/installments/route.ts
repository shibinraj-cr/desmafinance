import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { lockPlan } from "@/lib/collection-payment-server";

export const dynamic = "force-dynamic";

const PAGE = "/finance/collection-plan";

const InstallmentInput = z.object({
  expectedDate: z
    .string()
    .min(1)
    .refine((s) => !isNaN(Date.parse(s)), "Invalid date"),
  amount: z.coerce.number().positive().max(1_000_000_000),
  description: z.string().max(500).optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canSeePage(perms, PAGE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = InstallmentInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const data = parsed.data;

  const plan = await prisma.collectionPlan.findUnique({
    where: { id: params.id },
  });
  if (!plan) return NextResponse.json({ error: "plan_not_found" }, { status: 404 });
  if (plan.status !== "active") {
    return NextResponse.json({ error: "plan_not_active" }, { status: 400 });
  }

  // The next seq is read and used under the plan's lock, so a payment
  // renumbering the plan (or another add) can't take it meanwhile.
  const created = await prisma.$transaction(async (tx) => {
    await lockPlan(tx, plan.id);
    const last = await tx.collectionPlanInstallment.findFirst({
      where: { planId: plan.id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    return tx.collectionPlanInstallment.create({
      data: {
        planId: plan.id,
        seq: (last?.seq ?? 0) + 1,
        expectedDate: new Date(data.expectedDate),
        amount: data.amount,
        description: data.description ?? null,
      },
    });
  });
  const nextSeq = created.seq;

  await recordAudit({
    entityType: "CollectionPlanInstallment",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { planId: plan.id, seq: nextSeq, amount: data.amount },
  });

  return NextResponse.json({
    ok: true,
    installment: { ...created, amount: Number(created.amount.toString()) },
  });
}
