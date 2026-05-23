import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { toPrismaDate } from "@/lib/lead-pulse-dates";

export const dynamic = "force-dynamic";

const Schema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * POST /api/marketing/lead-pulse/lock-override
 *
 * Supervisor unlocks a (user, date) so the BDE can edit a previously
 * locked entry. Writes an `entry_locked_override` audit row carrying
 * the actor + target so we have full provenance.
 */
export async function POST(req: NextRequest) {
  const { userId: actorId, perms } = await getCurrentUserAndPermissions();
  if (!actorId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(actorId, perms);
  if (!access.canSupervise) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const dateValue = toPrismaDate(parsed.data.date);

  // Three writes:
  //   1. Clear the `locked` flag on any locked entry/meta for this
  //      (user, date) — addresses the explicit-locked path.
  //   2. Upsert a LeadPulseUnlock row — addresses the backdate-window
  //      block, which is the real reason "unlock didn't work" for
  //      Shency-style cases where the entry was outside the 3-day
  //      window. The save endpoint reads this row to bypass the
  //      backdate gate.
  //   3. Audit log entry for provenance.
  const [entries, meta] = await Promise.all([
    prisma.leadPulseDailyEntry.updateMany({
      where: { userId: parsed.data.userId, entryDate: dateValue, locked: true },
      data: { locked: false },
    }),
    prisma.leadPulseDailyMeta.updateMany({
      where: { userId: parsed.data.userId, entryDate: dateValue, locked: true },
      data: { locked: false },
    }),
  ]);

  await prisma.leadPulseUnlock.upsert({
    where: {
      userId_entryDate: { userId: parsed.data.userId, entryDate: dateValue },
    },
    create: {
      userId: parsed.data.userId,
      entryDate: dateValue,
      unlockedById: actorId,
    },
    update: { unlockedAt: new Date(), unlockedById: actorId },
  });

  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: actorId,
      eventType: "entry_locked_override",
      targetId: parsed.data.userId,
      metadata: {
        date: parsed.data.date,
        entriesUnlocked: entries.count,
        metaUnlocked: meta.count,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    entriesUnlocked: entries.count,
    backdateBypassGranted: true,
  });
}
