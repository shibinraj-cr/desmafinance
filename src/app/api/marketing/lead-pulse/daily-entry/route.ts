import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess, type LeadPulseRoleSlug } from "@/lib/lead-pulse-rbac";
import {
  isWithinBackdateWindow,
  toPrismaDate,
  todayIst,
  fromPrismaDate,
} from "@/lib/lead-pulse-dates";
import { validateL1Row, validateL2Row } from "@/lib/lead-pulse-validation";

export const dynamic = "force-dynamic";

const DateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/**
 * GET /api/marketing/lead-pulse/daily-entry?date=YYYY-MM-DD&userId=...
 *
 * Returns the row payload for that user × date: per-source numbers + meta.
 * - userId optional; supervisors / admins can read any user, BDEs always
 *   read their own.
 * - When the date has no entries yet, returns zeroed defaults so the form
 *   can render without an extra round-trip.
 */
export async function GET(req: NextRequest) {
  const { userId: actorId, perms } = await getCurrentUserAndPermissions();
  if (!actorId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dateStr = url.searchParams.get("date") ?? todayIst();
  const dateParse = DateParam.safeParse(dateStr);
  if (!dateParse.success) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  const requestedUserId = url.searchParams.get("userId");
  const access = await getLeadPulseAccess(actorId, perms);
  const targetUserId = requestedUserId && requestedUserId !== actorId
    ? (access.canSupervise ? requestedUserId : null)
    : actorId;
  if (!targetUserId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Load the target user's lead-pulse role; without one, BDE entries are
  // not applicable. Supervisors viewing other users still need to know
  // the role (l1 vs l2) so the right column set is returned.
  const targetRole = await prisma.leadPulseRole.findUnique({ where: { userId: targetUserId } });
  if (!targetRole && targetUserId === actorId) {
    return NextResponse.json({ error: "no_lead_pulse_role" }, { status: 403 });
  }

  const sources = await prisma.leadPulseSource.findMany({
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
  });
  const entries = await prisma.leadPulseDailyEntry.findMany({
    where: { userId: targetUserId, entryDate: toPrismaDate(dateParse.data) },
  });
  const meta = await prisma.leadPulseDailyMeta.findUnique({
    where: { userId_entryDate: { userId: targetUserId, entryDate: toPrismaDate(dateParse.data) } },
  });

  const today = todayIst();
  const editable = isWithinBackdateWindow(dateParse.data, today) && (
    !entries.some((e) => e.locked) && !(meta?.locked)
  );

  return NextResponse.json({
    date: dateParse.data,
    today,
    editable,
    role: (targetRole?.role ?? null) as LeadPulseRoleSlug | null,
    displayName: targetRole?.displayName ?? null,
    sources: sources.map((s) => ({
      id: s.id,
      code: s.code,
      label: s.label,
      displayOrder: s.displayOrder,
      active: s.active,
    })),
    entries: entries.map((e) => ({
      id: e.id,
      sourceId: e.sourceId,
      // L1
      leadsReceived: e.leadsReceived ?? 0,
      connectedCalls: e.connectedCalls ?? 0,
      disqualified: e.disqualified ?? 0,
      transferredToL2: e.transferredToL2 ?? 0,
      // L2
      receivedFromL1: e.receivedFromL1 ?? 0,
      directLeads: e.directLeads ?? 0,
      connected: e.connected ?? 0,
      quoteSent: e.quoteSent ?? 0,
      closedWon: e.closedWon ?? 0,
      closedLost: e.closedLost ?? 0,
      status: e.status,
      locked: e.locked,
      submittedAt: e.submittedAt?.toISOString() ?? null,
      entryDate: fromPrismaDate(e.entryDate),
    })),
    meta: meta
      ? {
          totalFollowups: meta.totalFollowups ?? 0,
          referredToDoc: meta.referredToDoc ?? 0,
          referredToAbroad: meta.referredToAbroad ?? 0,
          notes: meta.notes ?? "",
          status: meta.status,
          locked: meta.locked,
          submittedAt: meta.submittedAt?.toISOString() ?? null,
        }
      : {
          totalFollowups: 0,
          referredToDoc: 0,
          referredToAbroad: 0,
          notes: "",
          status: "draft" as const,
          locked: false,
          submittedAt: null,
        },
  });
}

const RowSchema = z.object({
  sourceId: z.string().min(1),
  // All numeric fields default 0 and must be non-negative integers. We
  // accept either undefined (treat as 0) or a number.
  leadsReceived: z.number().int().min(0).default(0),
  connectedCalls: z.number().int().min(0).default(0),
  disqualified: z.number().int().min(0).default(0),
  transferredToL2: z.number().int().min(0).default(0),
  receivedFromL1: z.number().int().min(0).default(0),
  directLeads: z.number().int().min(0).default(0),
  connected: z.number().int().min(0).default(0),
  quoteSent: z.number().int().min(0).default(0),
  closedWon: z.number().int().min(0).default(0),
  closedLost: z.number().int().min(0).default(0),
});

const SaveSchema = z.object({
  date: DateParam,
  action: z.enum(["draft", "submit"]),
  rows: z.array(RowSchema),
  meta: z.object({
    totalFollowups: z.number().int().min(0).default(0),
    referredToDoc: z.number().int().min(0).default(0),
    referredToAbroad: z.number().int().min(0).default(0),
    notes: z.string().max(2000).default(""),
  }),
});

/**
 * POST /api/marketing/lead-pulse/daily-entry
 *
 * Saves the entire day's payload atomically. Two modes:
 *  - action=draft   → status remains 'draft', auto-save
 *  - action=submit  → status flips to 'submitted', server validates rows
 *
 * The 3-day lock window is enforced server-side so a stale tab can't
 * overwrite a locked entry.
 */
export async function POST(req: NextRequest) {
  const { userId: actorId, perms } = await getCurrentUserAndPermissions();
  if (!actorId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = await getLeadPulseAccess(actorId, perms);
  if (access.role !== "l1" && access.role !== "l2") {
    return NextResponse.json({ error: "forbidden_no_bde_role" }, { status: 403 });
  }
  if (!access.canSubmitEntries) {
    return NextResponse.json({ error: "forbidden_inactive" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { date, action, rows, meta } = parsed.data;

  if (!isWithinBackdateWindow(date)) {
    return NextResponse.json({ error: "outside_backdate_window" }, { status: 403 });
  }

  // Re-fetch sources to reject row.sourceId that doesn't belong to an
  // active source. Inactive sources are read-only.
  const sources = await prisma.leadPulseSource.findMany({ where: { active: true } });
  const sourceIds = new Set(sources.map((s) => s.id));
  for (const r of rows) {
    if (!sourceIds.has(r.sourceId)) {
      return NextResponse.json({ error: "unknown_source", sourceId: r.sourceId }, { status: 400 });
    }
  }

  // Server-side validation per row (required for submit; row-level errors
  // also block draft saves so we never persist obviously-wrong data —
  // the client already prevents typing values that violate this).
  const role = access.role;
  for (const r of rows) {
    const err = role === "l1"
      ? validateL1Row({
          leadsReceived: r.leadsReceived,
          connectedCalls: r.connectedCalls,
          disqualified: r.disqualified,
          transferredToL2: r.transferredToL2,
        })
      : validateL2Row({
          receivedFromL1: r.receivedFromL1,
          directLeads: r.directLeads,
          connected: r.connected,
          quoteSent: r.quoteSent,
          closedWon: r.closedWon,
          closedLost: r.closedLost,
        });
    if (err) {
      return NextResponse.json(
        { error: "row_invalid", reason: err, sourceId: r.sourceId },
        { status: 400 },
      );
    }
  }

  const dateValue = toPrismaDate(date);
  const status = action === "submit" ? "submitted" : "draft";
  const submittedAt = action === "submit" ? new Date() : null;

  // Verify nothing in this date is locked. If even one row is locked,
  // refuse the save (a supervisor must override first).
  const existingLocked = await prisma.leadPulseDailyEntry.findFirst({
    where: { userId: actorId, entryDate: dateValue, locked: true },
    select: { id: true },
  });
  if (existingLocked) {
    return NextResponse.json({ error: "locked" }, { status: 409 });
  }
  const existingMetaLocked = await prisma.leadPulseDailyMeta.findUnique({
    where: { userId_entryDate: { userId: actorId, entryDate: dateValue } },
    select: { locked: true },
  });
  if (existingMetaLocked?.locked) {
    return NextResponse.json({ error: "locked" }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const data = role === "l1"
        ? {
            leadsReceived: r.leadsReceived,
            connectedCalls: r.connectedCalls,
            disqualified: r.disqualified,
            transferredToL2: r.transferredToL2,
            receivedFromL1: null,
            directLeads: null,
            connected: null,
            quoteSent: null,
            closedWon: null,
            closedLost: null,
          }
        : {
            leadsReceived: null,
            connectedCalls: null,
            disqualified: null,
            transferredToL2: null,
            receivedFromL1: r.receivedFromL1,
            directLeads: r.directLeads,
            connected: r.connected,
            quoteSent: r.quoteSent,
            closedWon: r.closedWon,
            closedLost: r.closedLost,
          };
      // Draft auto-saves must never downgrade a row that's already
      // been submitted — only the explicit "submit" action can flip
      // status. So we only write `status` on the update branch when
      // the user explicitly submitted.
      await tx.leadPulseDailyEntry.upsert({
        where: {
          userId_entryDate_sourceId: {
            userId: actorId,
            entryDate: dateValue,
            sourceId: r.sourceId,
          },
        },
        create: {
          userId: actorId,
          entryDate: dateValue,
          sourceId: r.sourceId,
          roleAtEntry: role,
          status,
          submittedAt,
          locked: false,
          ...data,
        },
        update: {
          roleAtEntry: role,
          ...(action === "submit"
            ? { status: "submitted", submittedAt: new Date() }
            : {}),
          ...data,
        },
      });
    }

    await tx.leadPulseDailyMeta.upsert({
      where: { userId_entryDate: { userId: actorId, entryDate: dateValue } },
      create: {
        userId: actorId,
        entryDate: dateValue,
        totalFollowups: role === "l1" ? meta.totalFollowups : null,
        referredToDoc: role === "l2" ? meta.referredToDoc : null,
        referredToAbroad: meta.referredToAbroad,
        notes: meta.notes,
        status,
        submittedAt,
        locked: false,
      },
      update: {
        totalFollowups: role === "l1" ? meta.totalFollowups : null,
        referredToDoc: role === "l2" ? meta.referredToDoc : null,
        referredToAbroad: meta.referredToAbroad,
        notes: meta.notes,
        ...(action === "submit"
          ? { status: "submitted", submittedAt: new Date() }
          : {}),
      },
    });

    if (action === "submit") {
      await tx.leadPulseAuditLog.create({
        data: {
          actorUserId: actorId,
          eventType: "entry_submitted",
          targetId: actorId,
          metadata: { date, role, rowCount: rows.length },
        },
      });
    }
  });

  return NextResponse.json({ ok: true, status });
}
