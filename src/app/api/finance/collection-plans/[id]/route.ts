import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { PAYMENT_MODES } from "@/lib/catalog";
import { verifyCategorySubItem } from "@/lib/master-data";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  label: z.string().min(1).max(160).optional(),
  category: z.string().min(1).max(120).optional(),
  subItem: z.string().min(1).max(160).optional(),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  expDom: z.enum(["EXP", "DOM"]).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  serviceId: z.string().min(1).optional().nullable(),
  status: z.enum(["active", "closed", "cancelled"]).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const plan = await prisma.collectionPlan.findUnique({
    where: { id: params.id },
    include: {
      party: { select: { id: true, name: true, group: true } },
      service: { select: { id: true, name: true } },
      installments: {
        orderBy: { seq: "asc" },
        include: {
          transaction: { select: { id: true, date: true, amount: true } },
        },
      },
      createdBy: { select: { id: true, username: true } },
    },
  });
  if (!plan) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    plan: {
      ...plan,
      installments: plan.installments.map((i) => ({
        ...i,
        amount: Number(i.amount.toString()),
        transaction: i.transaction
          ? {
              ...i.transaction,
              amount: Number(i.transaction.amount.toString()),
            }
          : null,
      })),
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await prisma.collectionPlan.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (data.category && data.subItem) {
    const verr = await verifyCategorySubItem(data.category, data.subItem, "Revenue");
    if (verr) return NextResponse.json({ error: verr }, { status: 400 });
  }
  if (data.serviceId) {
    const svc = await prisma.service.findUnique({ where: { id: data.serviceId } });
    if (!svc) return NextResponse.json({ error: "service_not_found" }, { status: 400 });
  }

  const updated = await prisma.collectionPlan.update({
    where: { id: params.id },
    data: {
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.subItem !== undefined ? { subItem: data.subItem } : {}),
      ...(data.paymentMode !== undefined ? { paymentMode: data.paymentMode } : {}),
      ...(data.expDom !== undefined ? { expDom: data.expDom } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.serviceId !== undefined ? { serviceId: data.serviceId } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    },
  });

  await recordAudit({
    entityType: "CollectionPlan",
    entityId: params.id,
    action: "UPDATE",
    userId,
    changes: data,
  });

  return NextResponse.json({ ok: true, plan: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const plan = await prisma.collectionPlan.findUnique({
    where: { id: params.id },
    include: { installments: true },
  });
  if (!plan) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Refuse deletion when any installment has been submitted/received.
  const blocking = plan.installments.find(
    (i) => i.status === "submitted" || i.status === "received",
  );
  if (blocking) {
    return NextResponse.json(
      { error: "has_active_installments", installmentId: blocking.id, status: blocking.status },
      { status: 409 },
    );
  }

  await prisma.collectionPlan.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "CollectionPlan",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { partyId: plan.partyId, label: plan.label },
  });
  return NextResponse.json({ ok: true });
}
