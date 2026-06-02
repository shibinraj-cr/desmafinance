import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

/**
 * Set (or clear) the manual Meta ad spend for a single month. Supervisor-only.
 *
 * Body: { year, month, amount: number | null, note? }
 *   - amount = number → upsert the override (₹ whole rupees).
 *   - amount = null   → delete the override so the Growth Planner falls back to
 *                       the Finance-derived figure for that month.
 *
 * Upserts on the (year, month) unique key and writes a LeadPulseAuditLog row,
 * mirroring the targets route. The planner page re-reads the baseline on refresh.
 */
const Schema = z.object({
  year: z.number().int().min(2024).max(2100),
  month: z.number().int().min(1).max(12),
  amount: z.number().int().min(0).max(1_000_000_000).nullable(),
  note: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return NextResponse.json({ error: "forbidden_supervisor_only" }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { year, month, amount, note } = parsed.data;

  const existing = await prisma.leadPulseMetaSpend.findUnique({
    where: { year_month: { year, month } },
    select: { amount: true },
  });

  if (amount === null) {
    if (existing) {
      await prisma.leadPulseMetaSpend.delete({ where: { year_month: { year, month } } });
      await prisma.leadPulseAuditLog.create({
        data: {
          actorUserId: userId,
          eventType: "entry_edited",
          metadata: { kind: "meta_spend_cleared", year, month, previousAmount: existing.amount },
        },
      });
    }
    return NextResponse.json({ ok: true, cleared: true });
  }

  await prisma.leadPulseMetaSpend.upsert({
    where: { year_month: { year, month } },
    create: { year, month, amount, note: note ?? null, updatedById: userId },
    update: { amount, note: note ?? null, updatedById: userId },
  });
  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "entry_edited",
      metadata: {
        kind: "meta_spend_update",
        year,
        month,
        previousAmount: existing?.amount ?? null,
        newAmount: amount,
      },
    },
  });

  return NextResponse.json({ ok: true, amount });
}
