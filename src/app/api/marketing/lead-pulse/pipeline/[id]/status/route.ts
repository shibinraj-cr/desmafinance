import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { isWithinBackdateWindow, toPrismaDate, todayIst } from "@/lib/lead-pulse-dates";

export const dynamic = "force-dynamic";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const Schema = z.object({
  status: z.enum(["open", "closed_won", "lost"]),
  closedDate: z.string().regex(DATE_RX).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * PATCH /api/marketing/lead-pulse/pipeline/[id]/status
 *
 * Transitions:
 *   open       → closed_won  (requires closedDate; bumps daily entry)
 *   open       → lost        (requires closedDate; no daily sync)
 *   closed_won → open        (reverses daily-entry side-effect)
 *   lost       → open        (just flip status)
 *
 * Locked / outside-backdate daily entries on the closedDate block the
 * closed_won path with `needs_unlock` — supervisor uses the existing
 * /api/marketing/lead-pulse/lock-override before BDE retries.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);

  const existing = await prisma.leadPulsePipeline.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // L2 BDE can flip own rows; supervisors can flip anyone's.
  if (existing.userId !== userId && !access.canSupervise) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  const fromStatus = existing.status;
  const toStatus = d.status;
  if (fromStatus === toStatus) {
    return NextResponse.json({ error: "no_change" }, { status: 400 });
  }

  // open → closed_won
  if (fromStatus === "open" && toStatus === "closed_won") {
    if (!d.closedDate) {
      return NextResponse.json({ error: "closedDate_required" }, { status: 400 });
    }
    const today = todayIst();
    if (d.closedDate > today) {
      return NextResponse.json({ error: "closedDate_in_future" }, { status: 400 });
    }

    const dateValue = toPrismaDate(d.closedDate);
    const existingEntry = await prisma.leadPulseDailyEntry.findUnique({
      where: {
        userId_entryDate_sourceId: {
          userId: existing.userId,
          entryDate: dateValue,
          sourceId: existing.sourceId,
        },
      },
    });

    if (existingEntry?.locked) {
      return NextResponse.json(
        { error: "needs_unlock", date: d.closedDate, userId: existing.userId },
        { status: 409 },
      );
    }
    if (!existingEntry && !isWithinBackdateWindow(d.closedDate, today)) {
      return NextResponse.json(
        { error: "needs_unlock", date: d.closedDate, userId: existing.userId },
        { status: 409 },
      );
    }

    // Upsert the daily entry, +1 closedWon, insert a LeadPulseDailyClose,
    // and persist the close id on the pipeline row — all in a single
    // transaction so partial state can't leak.
    const result = await prisma.$transaction(async (tx) => {
      const entry = existingEntry
        ? await tx.leadPulseDailyEntry.update({
            where: { id: existingEntry.id },
            data: { closedWon: (existingEntry.closedWon ?? 0) + 1 },
          })
        : await tx.leadPulseDailyEntry.create({
            data: {
              userId: existing.userId,
              entryDate: dateValue,
              sourceId: existing.sourceId,
              roleAtEntry: "l2",
              status: "draft",
              receivedFromL1: 0,
              directLeads: 0,
              connected: 0,
              quoteSent: 0,
              closedWon: 1,
              closedLost: 0,
              disqualified: 0,
              locked: false,
            },
          });
      const close = await tx.leadPulseDailyClose.create({
        data: { entryId: entry.id, serviceId: existing.serviceId },
      });
      await tx.leadPulsePipeline.update({
        where: { id: existing.id },
        data: {
          status: "closed_won",
          closedDate: dateValue,
          notes: d.notes !== undefined ? d.notes?.trim() || null : existing.notes,
          dailyCloseId: close.id,
        },
      });
      return { entryId: entry.id, closeId: close.id };
    });

    await prisma.leadPulseAuditLog.create({
      data: {
        actorUserId: userId,
        eventType: "pipeline_status_changed",
        targetId: existing.id,
        metadata: {
          from: fromStatus,
          to: toStatus,
          closedDate: d.closedDate,
          dailyEntryId: result.entryId,
          dailyCloseId: result.closeId,
        },
      },
    });

    return NextResponse.json({ ok: true });
  }

  // open → lost
  if (fromStatus === "open" && toStatus === "lost") {
    if (!d.closedDate) {
      return NextResponse.json({ error: "closedDate_required" }, { status: 400 });
    }
    await prisma.leadPulsePipeline.update({
      where: { id: existing.id },
      data: {
        status: "lost",
        closedDate: toPrismaDate(d.closedDate),
        notes: d.notes !== undefined ? d.notes?.trim() || null : existing.notes,
      },
    });
    await prisma.leadPulseAuditLog.create({
      data: {
        actorUserId: userId,
        eventType: "pipeline_status_changed",
        targetId: existing.id,
        metadata: { from: fromStatus, to: toStatus, closedDate: d.closedDate },
      },
    });
    return NextResponse.json({ ok: true });
  }

  // closed_won → open : reverse the daily-entry side-effect
  if (fromStatus === "closed_won" && toStatus === "open") {
    if (!existing.dailyCloseId) {
      // Shouldn't happen for a properly-synced closed_won row, but make
      // the path resilient — just flip the status if no close was logged.
      await prisma.leadPulsePipeline.update({
        where: { id: existing.id },
        data: { status: "open", closedDate: null },
      });
      await prisma.leadPulseAuditLog.create({
        data: {
          actorUserId: userId,
          eventType: "pipeline_status_changed",
          targetId: existing.id,
          metadata: { from: fromStatus, to: toStatus, note: "no_daily_close_linked" },
        },
      });
      return NextResponse.json({ ok: true });
    }

    const close = await prisma.leadPulseDailyClose.findUnique({
      where: { id: existing.dailyCloseId },
      include: { entry: true },
    });
    if (close?.entry.locked) {
      return NextResponse.json(
        { error: "needs_unlock", date: close.entry.entryDate.toISOString().slice(0, 10), userId: existing.userId },
        { status: 409 },
      );
    }

    await prisma.$transaction(async (tx) => {
      if (close) {
        await tx.leadPulseDailyClose.delete({ where: { id: close.id } });
        await tx.leadPulseDailyEntry.update({
          where: { id: close.entry.id },
          data: { closedWon: Math.max(0, (close.entry.closedWon ?? 0) - 1) },
        });
      }
      await tx.leadPulsePipeline.update({
        where: { id: existing.id },
        data: { status: "open", closedDate: null, dailyCloseId: null },
      });
    });

    await prisma.leadPulseAuditLog.create({
      data: {
        actorUserId: userId,
        eventType: "pipeline_status_changed",
        targetId: existing.id,
        metadata: { from: fromStatus, to: toStatus },
      },
    });
    return NextResponse.json({ ok: true });
  }

  // lost → open
  if (fromStatus === "lost" && toStatus === "open") {
    await prisma.leadPulsePipeline.update({
      where: { id: existing.id },
      data: { status: "open", closedDate: null },
    });
    await prisma.leadPulseAuditLog.create({
      data: {
        actorUserId: userId,
        eventType: "pipeline_status_changed",
        targetId: existing.id,
        metadata: { from: fromStatus, to: toStatus },
      },
    });
    return NextResponse.json({ ok: true });
  }

  // closed_won ↔ lost or other illegal transitions
  return NextResponse.json({ error: "illegal_transition", from: fromStatus, to: toStatus }, { status: 400 });
}
