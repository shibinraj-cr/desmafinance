import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const UpsertSchema = z.object({
  date: z.string().regex(DATE_RX, "date must be YYYY-MM-DD"),
  label: z.string().trim().min(1).max(160),
  notes: z.string().max(500).optional().nullable(),
});

const DeleteSchema = z.object({
  date: z.string().regex(DATE_RX),
});

/** Year filter via ?year=YYYY. Returns one row per stored holiday. */
export async function GET(req: NextRequest) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? Number(yearParam) : new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "bad_year" }, { status: 400 });
  }
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const rows = await prisma.holiday.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
    select: { id: true, date: true, label: true, notes: true },
  });
  return NextResponse.json({
    year,
    holidays: rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      label: r.label,
      notes: r.notes,
    })),
  });
}

export async function POST(req: NextRequest) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return NextResponse.json({ error: "forbidden_supervisor_only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { date, label, notes } = parsed.data;
  const dateValue = new Date(`${date}T00:00:00.000Z`);
  const existing = await prisma.holiday.findUnique({ where: { date: dateValue } });
  const saved = existing
    ? await prisma.holiday.update({
        where: { id: existing.id },
        data: { label: label.trim(), notes: notes?.trim() || null, updatedById: userId },
      })
    : await prisma.holiday.create({
        data: {
          date: dateValue,
          label: label.trim(),
          notes: notes?.trim() || null,
          createdById: userId,
          updatedById: userId,
        },
      });
  await recordAudit({
    entityType: "Holiday",
    entityId: saved.id,
    action: existing ? "UPDATE" : "CREATE",
    userId,
    changes: { date, label, notes: notes ?? null },
  });
  return NextResponse.json({
    holiday: {
      id: saved.id,
      date: saved.date.toISOString().slice(0, 10),
      label: saved.label,
      notes: saved.notes,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return NextResponse.json({ error: "forbidden_supervisor_only" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  const dateValue = new Date(`${parsed.data.date}T00:00:00.000Z`);
  const existing = await prisma.holiday.findUnique({ where: { date: dateValue } });
  if (!existing) return NextResponse.json({ ok: true });
  await prisma.holiday.delete({ where: { id: existing.id } });
  await recordAudit({
    entityType: "Holiday",
    entityId: existing.id,
    action: "DELETE",
    userId,
    changes: { date: parsed.data.date },
  });
  return NextResponse.json({ ok: true });
}
