import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const ActionSchema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(DATE_RX),
  action: z.enum(["approve", "reject"]),
  note: z.string().max(1000).optional(),
});

/**
 * GET /api/marketing/lead-pulse/approvals?status=submitted
 *
 * Supervisor-gated. Returns the queue of daily-entry submissions in
 * a given status (default 'submitted'). Each row carries enough
 * detail for the approvals list to render without a second round-
 * trip — BDE name, total leads on the day, and a per-source split.
 */
export async function GET(req: NextRequest) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return NextResponse.json({ error: "forbidden_supervisor_only" }, { status: 403 });
  }

  const status = req.nextUrl.searchParams.get("status") ?? "submitted";
  const metas = await prisma.leadPulseDailyMeta.findMany({
    where: { status },
    orderBy: [{ entryDate: "desc" }, { submittedAt: "desc" }],
    include: {
      user: { select: { id: true, username: true, leadPulseRole: { select: { displayName: true, role: true } } } },
    },
    take: 200,
  });

  // Hydrate per-day per-user totals from the entry rows.
  const entries = await prisma.leadPulseDailyEntry.findMany({
    where: {
      OR: metas.map((m) => ({
        userId: m.userId,
        entryDate: m.entryDate,
      })),
    },
    select: {
      userId: true,
      entryDate: true,
      sourceId: true,
      roleAtEntry: true,
      leadsReceived: true,
      receivedFromL1: true,
      directLeads: true,
      closedWon: true,
    },
  });
  const sources = await prisma.leadPulseSource.findMany({
    select: { id: true, label: true, code: true },
  });
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  type Row = {
    userId: string;
    date: string;
    displayName: string;
    role: string;
    totalLeads: number;
    closedWon: number;
    bySource: Record<string, number>;
    submittedAt: string | null;
  };
  const byKey = new Map<string, Row>();
  for (const m of metas) {
    const dateStr = m.entryDate.toISOString().slice(0, 10);
    const key = `${m.userId}|${dateStr}`;
    byKey.set(key, {
      userId: m.userId,
      date: dateStr,
      displayName: m.user.leadPulseRole?.displayName ?? m.user.username,
      role: m.user.leadPulseRole?.role ?? "—",
      totalLeads: 0,
      closedWon: 0,
      bySource: {},
      submittedAt: m.submittedAt?.toISOString() ?? null,
    });
  }
  for (const e of entries) {
    const dateStr = e.entryDate.toISOString().slice(0, 10);
    const key = `${e.userId}|${dateStr}`;
    const row = byKey.get(key);
    if (!row) continue;
    const leads =
      e.roleAtEntry === "l1"
        ? (e.leadsReceived ?? 0)
        : (e.receivedFromL1 ?? 0) + (e.directLeads ?? 0);
    row.totalLeads += leads;
    row.closedWon += e.closedWon ?? 0;
    const srcLabel = sourceById.get(e.sourceId)?.label ?? "?";
    row.bySource[srcLabel] = (row.bySource[srcLabel] ?? 0) + leads;
  }

  return NextResponse.json({ items: Array.from(byKey.values()) });
}

/**
 * POST /api/marketing/lead-pulse/approvals
 *
 * Body: { userId, date, action: 'approve' | 'reject', note? }.
 * Updates LeadPulseDailyMeta.status accordingly; reject requires a note.
 */
export async function POST(req: NextRequest) {
  const { userId: reviewerId, perms } = await getCurrentUserAndPermissions();
  if (!reviewerId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(reviewerId, perms);
  if (!access.canSupervise) {
    return NextResponse.json({ error: "forbidden_supervisor_only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { userId, date, action, note } = parsed.data;
  const trimmedNote = note?.trim() ?? "";
  if (action === "reject" && trimmedNote.length === 0) {
    return NextResponse.json({ error: "reject_requires_note" }, { status: 400 });
  }

  const dateValue = new Date(`${date}T00:00:00.000Z`);
  const meta = await prisma.leadPulseDailyMeta.findUnique({
    where: { userId_entryDate: { userId, entryDate: dateValue } },
  });
  if (!meta) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (meta.status !== "submitted") {
    return NextResponse.json(
      { error: "not_pending", currentStatus: meta.status },
      { status: 409 },
    );
  }

  const updated = await prisma.leadPulseDailyMeta.update({
    where: { id: meta.id },
    data: {
      status: action === "approve" ? "approved" : "rejected",
      reviewedById: reviewerId,
      reviewedAt: new Date(),
      reviewNote: trimmedNote || null,
    },
  });
  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: reviewerId,
      eventType: action === "approve" ? "entry_submitted" : "entry_edited",
      targetId: meta.id,
      metadata: {
        kind: action === "approve" ? "daily_meta_approved" : "daily_meta_rejected",
        userId,
        date,
        note: trimmedNote || null,
      },
    },
  });

  return NextResponse.json({ ok: true, status: updated.status });
}
