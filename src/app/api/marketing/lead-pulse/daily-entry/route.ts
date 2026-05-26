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
    include: {
      closes: {
        orderBy: { createdAt: "asc" },
        select: { serviceId: true },
      },
    },
  });
  const meta = await prisma.leadPulseDailyMeta.findUnique({
    where: { userId_entryDate: { userId: targetUserId, entryDate: toPrismaDate(dateParse.data) } },
  });
  // Supervisor unlock (if any) overrides the 3-day backdate window.
  // The per-row `locked` flag is still respected — both gates must
  // pass for the entry to be editable.
  const unlock = await prisma.leadPulseUnlock.findUnique({
    where: {
      userId_entryDate: {
        userId: targetUserId,
        entryDate: toPrismaDate(dateParse.data),
      },
    },
  });

  const today = todayIst();
  const withinWindow = isWithinBackdateWindow(dateParse.data, today);
  const supervisorUnlocked = !!unlock;
  const anyLocked = entries.some((e) => e.locked) || !!meta?.locked;
  // Editability rules — kept in lockstep with the page-server logic in
  // src/app/(app)/marketing/lead-pulse/daily-entry/page.tsx AND with
  // the save endpoint's lockBypass below, so the UI never lets the
  // BDE type into fields that the server will then refuse to persist.
  //
  //   - Rejected entries: always editable so the BDE can fix flagged
  //     issues and resubmit.
  //   - Supervisor-unlocked: editable as long as no row carries a
  //     hard `locked` flag (the unlock lifts both the backdate window
  //     and the approved-status block).
  //   - Approved without unlock: read-only — Suhaina has signed off.
  //   - Otherwise: must be within the 3-day window and no row locked.
  const editable =
    meta?.status === "rejected"
      ? true
      : supervisorUnlocked
        ? !anyLocked
        : meta?.status === "approved"
          ? false
          : withinWindow && !anyLocked;

  return NextResponse.json({
    date: dateParse.data,
    today,
    editable,
    supervisorUnlocked,
    unlockedAt: unlock?.unlockedAt?.toISOString() ?? null,
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
      closedServiceIds: e.closes.map((c) => c.serviceId),
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
  // L2 only — one entry per closed lead, identifying which Service
  // the BDE credits the close to. Empty strings allowed for drafts;
  // on submit, the array length must equal closedWon.
  closedServiceIds: z.array(z.string()).optional().default([]),
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

  // Outside the 3-day backdate window, a supervisor must have granted
  // an explicit LeadPulseUnlock for this (user, date). The unlock is
  // cleared further down on a successful submit so the next edit
  // requires a fresh grant.
  const dateValueEarly = toPrismaDate(date);
  const unlockRow = await prisma.leadPulseUnlock.findUnique({
    where: { userId_entryDate: { userId: actorId, entryDate: dateValueEarly } },
  });
  if (!isWithinBackdateWindow(date) && !unlockRow) {
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
          disqualified: r.disqualified,
        });
    if (err) {
      return NextResponse.json(
        { error: "row_invalid", reason: err, sourceId: r.sourceId },
        { status: 400 },
      );
    }
    // Service-count check for L2 closes. Drafts can save with a
    // shorter or partly-empty list (BDE may be mid-edit); submits
    // must pick exactly closedWon services with no empty slots.
    if (role === "l2") {
      const filledIds = (r.closedServiceIds ?? []).filter((s) => s.trim() !== "");
      if (action === "submit") {
        if (filledIds.length !== r.closedWon) {
          return NextResponse.json(
            {
              error: "service_count_mismatch",
              sourceId: r.sourceId,
              expected: r.closedWon,
              got: filledIds.length,
            },
            { status: 400 },
          );
        }
      }
    }
  }

  // Validate every supplied serviceId resolves to a real Service row.
  const allServiceIds = Array.from(
    new Set(
      rows
        .flatMap((r) => r.closedServiceIds ?? [])
        .filter((s) => s.trim() !== ""),
    ),
  );
  if (allServiceIds.length > 0) {
    const found = await prisma.service.findMany({
      where: { id: { in: allServiceIds } },
      select: { id: true },
    });
    if (found.length !== allServiceIds.length) {
      return NextResponse.json({ error: "unknown_service" }, { status: 400 });
    }
  }

  const dateValue = toPrismaDate(date);
  const status = action === "submit" ? "submitted" : "draft";
  const submittedAt = action === "submit" ? new Date() : null;

  // Verify nothing in this date is locked. Rejected entries are
  // explicitly editable so the BDE can correct supervisor flags and
  // re-submit. Approved entries are normally off-limits — but a
  // supervisor unlock (LeadPulseUnlock row) lifts the lock + the
  // approved-status block so the BDE can edit. The re-submit then
  // pushes the entry back to status="submitted", which puts it back
  // in Suhaina's approval queue.
  const existingMeta = await prisma.leadPulseDailyMeta.findUnique({
    where: { userId_entryDate: { userId: actorId, entryDate: dateValue } },
    select: { locked: true, status: true },
  });
  const lockBypass = existingMeta?.status === "rejected" || !!unlockRow;
  if (!lockBypass) {
    const existingLocked = await prisma.leadPulseDailyEntry.findFirst({
      where: { userId: actorId, entryDate: dateValue, locked: true },
      select: { id: true },
    });
    if (existingLocked) {
      return NextResponse.json({ error: "locked" }, { status: 409 });
    }
    if (existingMeta?.locked) {
      return NextResponse.json({ error: "locked" }, { status: 409 });
    }
    if (existingMeta?.status === "approved") {
      return NextResponse.json({ error: "approved_locked" }, { status: 409 });
    }
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
            // disqualified is a shared field — L2 supervisors track
            // candidates they screen out as well, so we persist it on
            // L2 rows too.
            disqualified: r.disqualified,
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
      const upserted = await tx.leadPulseDailyEntry.upsert({
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
      // Replace per-close service rows for L2 entries. We always
      // wipe and re-write so the stored set matches the payload
      // exactly — including dropping rows when closedWon shrinks.
      if (role === "l2") {
        await tx.leadPulseDailyClose.deleteMany({ where: { entryId: upserted.id } });
        const ids = (r.closedServiceIds ?? []).filter((s) => s.trim() !== "");
        if (ids.length > 0) {
          await tx.leadPulseDailyClose.createMany({
            data: ids.map((serviceId) => ({ entryId: upserted.id, serviceId })),
          });
        }
      }
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
          ? {
              status: "submitted",
              submittedAt: new Date(),
              // Clear prior approval/rejection metadata so a resubmit
              // (e.g. after a supervisor unlock) lands in the queue as
              // a clean pending item rather than re-displaying the
              // earlier reviewer's note.
              reviewedById: null,
              reviewedAt: null,
              reviewNote: null,
            }
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
      // A successful re-submit on a supervisor-unlocked day consumes
      // the grant — the next edit will need a fresh unlock.
      if (unlockRow) {
        await tx.leadPulseUnlock.delete({ where: { id: unlockRow.id } });
      }
    }
  });

  return NextResponse.json({ ok: true, status });
}
