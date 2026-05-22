import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

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

  const body = await req.json().catch(() => null);
  const parsed = InstallmentInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const data = parsed.data;

  const plan = await prisma.collectionPlan.findUnique({
    where: { id: params.id },
    include: { installments: { orderBy: { seq: "desc" }, take: 1 } },
  });
  if (!plan) return NextResponse.json({ error: "plan_not_found" }, { status: 404 });
  if (plan.status !== "active") {
    return NextResponse.json({ error: "plan_not_active" }, { status: 400 });
  }

  const nextSeq = (plan.installments[0]?.seq ?? 0) + 1;
  const created = await prisma.collectionPlanInstallment.create({
    data: {
      planId: plan.id,
      seq: nextSeq,
      expectedDate: new Date(data.expectedDate),
      amount: data.amount,
      description: data.description ?? null,
    },
  });

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
