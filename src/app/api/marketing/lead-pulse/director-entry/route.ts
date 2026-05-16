import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { toPrismaDate } from "@/lib/lead-pulse-dates";

export const dynamic = "force-dynamic";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const DIRECTOR_USERNAME = "devika";

const SaveSchema = z.object({
  date: z.string().regex(DATE_RX),
  closes: z.record(z.string(), z.number().int().min(0)),
});

/**
 * GET ?date=YYYY-MM-DD — returns Devika's existing closed-won counts
 *   per source for the day so the form pre-fills.
 * POST { date, closes: { [sourceId]: number } } — upserts only
 *   `closedWon` for Devika's L2 rows on that date. All other lead
 *   fields stay 0 since the director doesn't track them.
 *
 * Supervisor-gated (Suhaina + admins).
 */
async function ensureSupervisor() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return { error: "unauthorized" as const, status: 401 };
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) return { error: "forbidden" as const, status: 403 };
  return { userId, access };
}

async function getDirectorId() {
  const u = await prisma.user.findFirst({
    where: { username: { equals: DIRECTOR_USERNAME, mode: "insensitive" } },
    select: { id: true },
  });
  return u?.id ?? null;
}

export async function GET(req: NextRequest) {
  const guard = await ensureSupervisor();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const directorId = await getDirectorId();
  if (!directorId) {
    return NextResponse.json({ error: "director_not_found" }, { status: 404 });
  }
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !DATE_RX.test(date)) {
    return NextResponse.json({ error: "bad_date" }, { status: 400 });
  }
  const rows = await prisma.leadPulseDailyEntry.findMany({
    where: { userId: directorId, entryDate: toPrismaDate(date), roleAtEntry: "l2" },
    select: { sourceId: true, closedWon: true },
  });
  const closes: Record<string, number> = {};
  for (const r of rows) closes[r.sourceId] = r.closedWon ?? 0;
  return NextResponse.json({ closes });
}

export async function POST(req: NextRequest) {
  const guard = await ensureSupervisor();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const directorId = await getDirectorId();
  if (!directorId) {
    return NextResponse.json({ error: "director_not_found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { date, closes } = parsed.data;
  const dateValue = toPrismaDate(date);

  const sources = await prisma.leadPulseSource.findMany({ select: { id: true } });
  const validSourceIds = new Set(sources.map((s) => s.id));

  let written = 0;
  for (const [sourceId, closedWon] of Object.entries(closes)) {
    if (!validSourceIds.has(sourceId)) continue;
    await prisma.leadPulseDailyEntry.upsert({
      where: {
        userId_entryDate_sourceId: {
          userId: directorId,
          entryDate: dateValue,
          sourceId,
        },
      },
      create: {
        userId: directorId,
        entryDate: dateValue,
        sourceId,
        roleAtEntry: "l2",
        status: "submitted",
        submittedAt: new Date(),
        locked: false,
        receivedFromL1: 0,
        directLeads: 0,
        connected: 0,
        quoteSent: 0,
        closedWon,
        closedLost: 0,
        disqualified: 0,
      },
      update: {
        roleAtEntry: "l2",
        status: "submitted",
        submittedAt: new Date(),
        closedWon,
      },
    });
    written += 1;
  }
  // Mark meta as submitted+approved (director entries are inherently
  // signed off because Suhaina is entering them herself).
  await prisma.leadPulseDailyMeta.upsert({
    where: { userId_entryDate: { userId: directorId, entryDate: dateValue } },
    create: {
      userId: directorId,
      entryDate: dateValue,
      totalFollowups: null,
      referredToDoc: 0,
      referredToAbroad: 0,
      notes: null,
      status: "approved",
      submittedAt: new Date(),
      locked: false,
      reviewedById: guard.userId,
      reviewedAt: new Date(),
    },
    update: {
      status: "approved",
      reviewedById: guard.userId,
      reviewedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, written });
}
