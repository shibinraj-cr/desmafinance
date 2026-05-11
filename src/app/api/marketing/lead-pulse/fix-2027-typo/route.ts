import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

/**
 * One-shot fix for the year-typo on Anila's January entries in the
 * historical Excel. Rows 6–10 of the `Anila(L2)` sheet were entered
 * with year 2027 instead of 2026 — the rest of the workbook resumes
 * correctly on row 11 with 2026-01-06. Only one row actually carries
 * non-zero data (2027-01-03, Wabis = 12), but we shift every 2027
 * row for completeness in case any zero-value entries also landed.
 *
 * Idempotent: re-running after the fix is a no-op (no rows remain
 * with year = 2027). Skips the shift if a colliding 2026-MM-DD row
 * already exists for the same (user, source) to preserve audit
 * fidelity — reports collisions instead of overwriting.
 */
export async function POST() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return NextResponse.json({ error: "forbidden_supervisor_only" }, { status: 403 });
  }

  const log: string[] = [];

  // Find every entry whose year is 2027 — should be exclusively Anila's
  // typo-imported rows. We don't filter by user because the safe-by-
  // default behaviour is "any 2027 data is a typo" per the report.
  const yearStart = new Date(Date.UTC(2027, 0, 1));
  const yearEnd = new Date(Date.UTC(2028, 0, 1));
  const stray = await prisma.leadPulseDailyEntry.findMany({
    where: { entryDate: { gte: yearStart, lt: yearEnd } },
    include: {
      user: { select: { username: true } },
      source: { select: { code: true, label: true } },
    },
  });

  let entriesShifted = 0;
  let entriesSkippedCollision = 0;

  for (const e of stray) {
    const shifted = new Date(e.entryDate);
    shifted.setUTCFullYear(shifted.getUTCFullYear() - 1);
    // Check collision: a 2026-MM-DD row for the same (user, source)
    // would block the unique-key shift.
    const collision = await prisma.leadPulseDailyEntry.findUnique({
      where: {
        userId_entryDate_sourceId: {
          userId: e.userId,
          entryDate: shifted,
          sourceId: e.sourceId,
        },
      },
    });
    const shiftedStr = shifted.toISOString().slice(0, 10);
    const origStr = e.entryDate.toISOString().slice(0, 10);
    if (collision) {
      entriesSkippedCollision++;
      log.push(
        `! ${e.user.username} · ${e.source.label}: ${origStr} → ${shiftedStr} — collision, skipped`,
      );
      continue;
    }
    await prisma.leadPulseDailyEntry.update({
      where: { id: e.id },
      data: { entryDate: shifted },
    });
    entriesShifted++;
    log.push(`✓ ${e.user.username} · ${e.source.label}: ${origStr} → ${shiftedStr}`);
  }

  // Same shift for the daily-meta rows.
  const strayMeta = await prisma.leadPulseDailyMeta.findMany({
    where: { entryDate: { gte: yearStart, lt: yearEnd } },
    include: { user: { select: { username: true } } },
  });
  let metaShifted = 0;
  let metaSkippedCollision = 0;
  for (const m of strayMeta) {
    const shifted = new Date(m.entryDate);
    shifted.setUTCFullYear(shifted.getUTCFullYear() - 1);
    const collision = await prisma.leadPulseDailyMeta.findUnique({
      where: { userId_entryDate: { userId: m.userId, entryDate: shifted } },
    });
    if (collision) {
      metaSkippedCollision++;
      continue;
    }
    await prisma.leadPulseDailyMeta.update({
      where: { id: m.id },
      data: { entryDate: shifted },
    });
    metaShifted++;
  }

  if (entriesShifted > 0 || metaShifted > 0) {
    await prisma.leadPulseAuditLog.create({
      data: {
        actorUserId: userId,
        eventType: "entry_edited",
        targetId: null,
        metadata: {
          kind: "fix_2027_year_typo",
          entriesShifted,
          entriesSkippedCollision,
          metaShifted,
          metaSkippedCollision,
        },
      },
    });
  }

  return NextResponse.json({
    ok: true,
    summary: {
      entriesShifted,
      entriesSkippedCollision,
      metaShifted,
      metaSkippedCollision,
    },
    log,
  });
}
