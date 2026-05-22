import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { PAYMENT_MODES } from "@/lib/catalog";
import { verifyCategorySubItem } from "@/lib/master-data";
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

const PlanInput = z.object({
  partyId: z.string().min(1),
  serviceId: z.string().min(1).optional().nullable(),
  label: z.string().min(1).max(160),
  // Category / sub-item / payment-mode / EXP-DOM are captured at the
  // per-installment "Submit to Daily Tracker" step, not at plan-create,
  // so they're optional here.
  category: z.string().min(1).max(120).optional().nullable(),
  subItem: z.string().min(1).max(160).optional().nullable(),
  paymentMode: z.enum(PAYMENT_MODES).optional().nullable(),
  expDom: z.enum(["EXP", "DOM"]).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  installments: z.array(InstallmentInput).min(1).max(60),
});

export async function GET(req: NextRequest) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const partyId = searchParams.get("partyId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;

  const plans = await prisma.collectionPlan.findMany({
    where: {
      ...(partyId ? { partyId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      party: { select: { id: true, name: true, group: true } },
      service: { select: { id: true, name: true } },
      installments: { orderBy: { seq: "asc" } },
    },
  });

  return NextResponse.json({
    items: plans.map((p) => ({
      ...p,
      installments: p.installments.map((i) => ({
        ...i,
        amount: Number(i.amount.toString()),
      })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PlanInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const party = await prisma.party.findUnique({
    where: { id: data.partyId },
    select: { id: true, isActive: true, txTypes: true },
  });
  if (!party || !party.isActive) {
    return NextResponse.json({ error: "party_not_found" }, { status: 400 });
  }
  if (party.txTypes !== "Both" && party.txTypes !== "Revenue") {
    return NextResponse.json({ error: "party_tx_type_mismatch" }, { status: 400 });
  }

  // Only validate the category/sub-item pair if the user actually
  // supplied them (otherwise they'll be picked at submit time).
  if (data.category && data.subItem) {
    const verr = await verifyCategorySubItem(data.category, data.subItem, "Revenue");
    if (verr) return NextResponse.json({ error: verr }, { status: 400 });
  }

  if (data.serviceId) {
    const svc = await prisma.service.findUnique({ where: { id: data.serviceId } });
    if (!svc) return NextResponse.json({ error: "service_not_found" }, { status: 400 });
  }

  const plan = await prisma.collectionPlan.create({
    data: {
      partyId: data.partyId,
      serviceId: data.serviceId ?? null,
      label: data.label,
      category: data.category ?? null,
      subItem: data.subItem ?? null,
      paymentMode: data.paymentMode ?? null,
      expDom: data.expDom ?? null,
      notes: data.notes ?? null,
      createdById: userId,
      installments: {
        create: data.installments.map((i, idx) => ({
          seq: idx + 1,
          expectedDate: new Date(i.expectedDate),
          amount: i.amount,
          description: i.description ?? null,
        })),
      },
    },
    include: { installments: { orderBy: { seq: "asc" } } },
  });

  await recordAudit({
    entityType: "CollectionPlan",
    entityId: plan.id,
    action: "CREATE",
    userId,
    changes: {
      partyId: data.partyId,
      label: data.label,
      installmentCount: data.installments.length,
      totalAmount: data.installments.reduce((s, i) => s + i.amount, 0),
    },
  });

  return NextResponse.json({
    ok: true,
    plan: {
      ...plan,
      installments: plan.installments.map((i) => ({
        ...i,
        amount: Number(i.amount.toString()),
      })),
    },
  });
}
