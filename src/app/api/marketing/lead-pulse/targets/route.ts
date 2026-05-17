import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

/**
 * Bulk-upsert monthly L2-BDE × ServiceGroup targets. Supervisor-only.
 *
 * Body: { year, month, updates: [{ userId, groupId, target }] }
 *
 * The matrix is now group-based — `serviceId` stays as a legacy
 * fallback so older clients keep working, but every new write should
 * use `groupId`. Each cell upserts on (year, month, userId, groupId)
 * and writes a LeadPulseAuditLog row.
 */
const Schema = z.object({
  year: z.number().int().min(2024).max(2100),
  month: z.number().int().min(1).max(12),
  updates: z
    .array(
      z.object({
        userId: z.string().min(1),
        groupId: z.string().min(1).optional(),
        serviceId: z.string().min(1).optional(),
        target: z.number().int().min(0).max(10_000),
      }),
    )
    .min(1)
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
  const { year, month, updates } = parsed.data;

  let upserted = 0;
  for (const u of updates) {
    if (u.groupId) {
      const existing = await prisma.leadPulseTarget.findUnique({
        where: {
          year_month_userId_groupId: {
            year,
            month,
            userId: u.userId,
            groupId: u.groupId,
          },
        },
      });
      if (existing && existing.target === u.target) continue;
      await prisma.leadPulseTarget.upsert({
        where: {
          year_month_userId_groupId: {
            year,
            month,
            userId: u.userId,
            groupId: u.groupId,
          },
        },
        create: {
          year,
          month,
          userId: u.userId,
          groupId: u.groupId,
          target: u.target,
          updatedById: userId,
        },
        update: { target: u.target, updatedById: userId },
      });
      upserted++;
      await prisma.leadPulseAuditLog.create({
        data: {
          actorUserId: userId,
          eventType: "entry_edited",
          targetId: u.userId,
          metadata: {
            kind: "group_target_update",
            year,
            month,
            groupId: u.groupId,
            previousTarget: existing?.target ?? null,
            newTarget: u.target,
          },
        },
      });
      continue;
    }
    if (u.serviceId) {
      const existing = await prisma.leadPulseTarget.findUnique({
        where: {
          year_month_userId_serviceId: {
            year,
            month,
            userId: u.userId,
            serviceId: u.serviceId,
          },
        },
      });
      if (existing && existing.target === u.target) continue;
      await prisma.leadPulseTarget.upsert({
        where: {
          year_month_userId_serviceId: {
            year,
            month,
            userId: u.userId,
            serviceId: u.serviceId,
          },
        },
        create: {
          year,
          month,
          userId: u.userId,
          serviceId: u.serviceId,
          target: u.target,
          updatedById: userId,
        },
        update: { target: u.target, updatedById: userId },
      });
      upserted++;
    }
  }

  return NextResponse.json({
    ok: true,
    summary: { received: updates.length, upserted, skippedNoChange: updates.length - upserted },
  });
}
