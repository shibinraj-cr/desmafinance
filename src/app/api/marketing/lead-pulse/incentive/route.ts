import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { todayIst } from "@/lib/lead-pulse-dates";
import { SLAB_COUNT, isIncentiveMonthClosed, slabColumns, validateSlabs } from "@/lib/crm-incentive";

export const dynamic = "force-dynamic";

/**
 * Save a month's L2 incentive setup from the target sheet's "Minimum & slabs"
 * tab. Supervisor-only; a closed (past) month is admin-only.
 *
 * Body: { year, month, bonuses?, rows: [{ userId, minimum, slabs }] }
 *   - bonuses — the month-wide target / 48-hour / referral amounts;
 *   - rows    — only the BDEs whose setup changed. A row with no minimum and
 *               no slabs deletes the BDE's setup (they earn no incentive).
 * Each change writes a LeadPulseAuditLog row.
 */
const Count = z.number().int().min(0).max(10_000);
const Rupees = z.number().int().min(0).max(10_000_000);

const Schema = z.object({
  year: z.number().int().min(2024).max(2100),
  month: z.number().int().min(1).max(12),
  bonuses: z.object({ targetBonus: Rupees, fastCloseBonus: Rupees, referralBonus: Rupees }).optional(),
  rows: z
    .array(
      z.object({
        userId: z.string().min(1),
        minimum: Count.nullable(),
        slabs: z
          .array(z.object({ from: z.number().nullable(), rate: z.number().nullable() }))
          .max(SLAB_COUNT),
      }),
    )
    .max(500),
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

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { year, month, bonuses, rows } = parsed.data;

  if (isIncentiveMonthClosed(year, month, todayIst()) && !access.desfinAdmin) {
    return NextResponse.json({ error: "month_closed", message: "This month is closed. Only an admin can change it." }, { status: 403 });
  }

  for (const r of rows) {
    const problem = validateSlabs(r.slabs);
    if (problem) {
      return NextResponse.json({ error: "invalid_slabs", userId: r.userId, message: problem }, { status: 400 });
    }
  }

  // Only L2 BDEs carry an incentive (L1s have no slabs).
  const ids = [...new Set(rows.map((r) => r.userId))];
  if (ids.length !== rows.length) {
    return NextResponse.json({ error: "duplicate_user" }, { status: 400 });
  }
  if (ids.length) {
    const l2 = await prisma.leadPulseRole.findMany({ where: { userId: { in: ids }, role: "l2" }, select: { userId: true } });
    if (l2.length !== ids.length) {
      return NextResponse.json({ error: "not_l2_bde", message: "Incentives can only be set for L2 BDEs." }, { status: 400 });
    }
  }

  let changed = 0;

  if (bonuses) {
    const existing = await prisma.leadPulseIncentiveMonth.findUnique({ where: { year_month: { year, month } } });
    const same =
      existing &&
      existing.targetBonus === bonuses.targetBonus &&
      existing.fastCloseBonus === bonuses.fastCloseBonus &&
      existing.referralBonus === bonuses.referralBonus;
    if (!same) {
      await prisma.leadPulseIncentiveMonth.upsert({
        where: { year_month: { year, month } },
        create: { year, month, ...bonuses, updatedById: userId },
        update: { ...bonuses, updatedById: userId },
      });
      changed++;
      await prisma.leadPulseAuditLog.create({
        data: {
          actorUserId: userId,
          eventType: "entry_edited",
          metadata: {
            kind: "incentive_bonuses_update",
            year,
            month,
            previous: existing
              ? { targetBonus: existing.targetBonus, fastCloseBonus: existing.fastCloseBonus, referralBonus: existing.referralBonus }
              : null,
            next: bonuses,
          },
        },
      });
    }
  }

  for (const r of rows) {
    const where = { year_month_userId: { year, month, userId: r.userId } };
    const existing = await prisma.leadPulseIncentive.findUnique({ where });
    const cols = slabColumns(r.slabs);
    const empty = r.minimum === null && r.slabs.every((s) => s.from === null && s.rate === null);
    if (empty) {
      if (!existing) continue;
      await prisma.leadPulseIncentive.delete({ where });
    } else {
      await prisma.leadPulseIncentive.upsert({
        where,
        create: { year, month, userId: r.userId, minimum: r.minimum, ...cols, updatedById: userId },
        update: { minimum: r.minimum, ...cols, updatedById: userId },
      });
    }
    changed++;
    await prisma.leadPulseAuditLog.create({
      data: {
        actorUserId: userId,
        eventType: "entry_edited",
        targetId: r.userId,
        metadata: {
          kind: "incentive_slabs_update",
          year,
          month,
          previous: existing
            ? {
                minimum: existing.minimum,
                slab1From: existing.slab1From,
                slab1Rate: existing.slab1Rate,
                slab2From: existing.slab2From,
                slab2Rate: existing.slab2Rate,
                slab3From: existing.slab3From,
                slab3Rate: existing.slab3Rate,
                slab4From: existing.slab4From,
                slab4Rate: existing.slab4Rate,
              }
            : null,
          next: empty ? null : { minimum: r.minimum, ...cols },
        },
      },
    });
  }

  return NextResponse.json({ ok: true, changed });
}
