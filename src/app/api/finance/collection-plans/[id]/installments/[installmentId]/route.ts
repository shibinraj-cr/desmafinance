import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { PAYMENT_MODES } from "@/lib/catalog";
import { verifyCategorySubItem } from "@/lib/master-data";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PAGE = "/finance/collection-plan";

const PatchSchema = z.object({
  expectedDate: z
    .string()
    .min(1)
    .refine((s) => !isNaN(Date.parse(s)), "Invalid date")
    .optional(),
  amount: z.coerce.number().positive().max(1_000_000_000).optional(),
  description: z.string().max(500).optional().nullable(),
  category: z.string().min(1).max(120).optional().nullable(),
  subItem: z.string().min(1).max(160).optional().nullable(),
  paymentMode: z.enum(PAYMENT_MODES).optional().nullable(),
  status: z.enum(["pending", "cancelled"]).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; installmentId: string } },
) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canSeePage(perms, PAGE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await prisma.collectionPlanInstallment.findUnique({
    where: { id: params.installmentId },
  });
  if (!existing || existing.planId !== params.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.status === "received" || existing.status === "submitted") {
    return NextResponse.json(
      { error: "installment_locked", status: existing.status },
      { status: 409 },
    );
  }

  // Validate category/subItem override against the master if set.
  if ((data.category && data.subItem) || (data.category && !existing.subItem)) {
    const cat = data.category ?? existing.category ?? "";
    const sub = data.subItem ?? existing.subItem ?? "";
    if (cat && sub) {
      const verr = await verifyCategorySubItem(cat, sub, "Revenue");
      if (verr) return NextResponse.json({ error: verr }, { status: 400 });
    }
  }

  const updated = await prisma.collectionPlanInstallment.update({
    where: { id: params.installmentId },
    data: {
      ...(data.expectedDate ? { expectedDate: new Date(data.expectedDate) } : {}),
      ...(data.amount !== undefined ? { amount: data.amount } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.subItem !== undefined ? { subItem: data.subItem } : {}),
      ...(data.paymentMode !== undefined ? { paymentMode: data.paymentMode } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    },
  });

  await recordAudit({
    entityType: "CollectionPlanInstallment",
    entityId: params.installmentId,
    action: "UPDATE",
    userId,
    changes: data,
  });

  return NextResponse.json({
    ok: true,
    installment: { ...updated, amount: Number(updated.amount.toString()) },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; installmentId: string } },
) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canSeePage(perms, PAGE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const existing = await prisma.collectionPlanInstallment.findUnique({
    where: { id: params.installmentId },
  });
  if (!existing || existing.planId !== params.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.status === "submitted" || existing.status === "received") {
    return NextResponse.json(
      { error: "installment_locked", status: existing.status },
      { status: 409 },
    );
  }
  await prisma.collectionPlanInstallment.delete({ where: { id: params.installmentId } });
  await recordAudit({
    entityType: "CollectionPlanInstallment",
    entityId: params.installmentId,
    action: "DELETE",
    userId,
    changes: { planId: params.id, seq: existing.seq },
  });
  return NextResponse.json({ ok: true });
}
