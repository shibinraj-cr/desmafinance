import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const PatchSchema = z.object({
  candidateName: z.string().trim().min(1).max(160).optional(),
  candidatePhone: z.string().trim().max(40).nullable().optional(),
  serviceId: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  expectedCloseDate: z.string().regex(DATE_RX).optional(),
  expectedFirstInstallment: z.number().nonnegative().max(100_000_000).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function canEdit(opts: { ownerId: string; actorId: string; canSupervise: boolean }) {
  return opts.canSupervise || opts.ownerId === opts.actorId;
}

/**
 * A pipeline row created from a CRM lead is a MIRROR, not a record — the CRM
 * lead owns the service / value / expected close date and re-writes them onto
 * this row on every "Set deal". Editing or deleting the mirror here would be
 * silently overwritten by the next CRM edit, and would show the two modules
 * disagreeing until then. The edit belongs on the lead itself.
 */
function crmOwned(leadId: string) {
  return NextResponse.json(
    {
      error: "crm_owned",
      leadId,
      message: "This deal is owned by its CRM lead — edit it there and it will update here.",
    },
    { status: 409 },
  );
}

/**
 * PATCH /api/marketing/lead-pulse/pipeline/[id]
 *
 * Edit any non-status field while the row is still open. Closed rows
 * must be re-opened first (via the /status endpoint) so the daily-
 * entry side-effect is cleanly reversed before edits.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);

  const existing = await prisma.leadPulsePipeline.findUnique({
    where: { id: params.id },
    include: { leadLink: { select: { id: true } } },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit({ ownerId: existing.userId, actorId: userId, canSupervise: access.canSupervise })) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (existing.leadLink) return crmOwned(existing.leadLink.id);
  if (existing.status !== "open") {
    return NextResponse.json({ error: "row_not_open" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  const data: Record<string, unknown> = {};
  if (d.candidateName !== undefined) data.candidateName = d.candidateName;
  if (d.candidatePhone !== undefined) data.candidatePhone = d.candidatePhone?.trim() || null;
  if (d.serviceId !== undefined) data.serviceId = d.serviceId;
  if (d.sourceId !== undefined) data.sourceId = d.sourceId;
  if (d.expectedCloseDate !== undefined) {
    data.expectedCloseDate = new Date(`${d.expectedCloseDate}T00:00:00.000Z`);
  }
  if (d.expectedFirstInstallment !== undefined) {
    data.expectedFirstInstallment = d.expectedFirstInstallment;
  }
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;

  const updated = await prisma.leadPulsePipeline.update({
    where: { id: params.id },
    data,
  });

  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "pipeline_edited",
      targetId: updated.id,
      metadata: { changed: Object.keys(d) },
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);

  const existing = await prisma.leadPulsePipeline.findUnique({
    where: { id: params.id },
    include: { leadLink: { select: { id: true } } },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEdit({ ownerId: existing.userId, actorId: userId, canSupervise: access.canSupervise })) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Deleting the mirror would strand the lead's deal: the lead keeps its
  // expectedValue / expectedCloseDate but drops out of every forecast, with
  // nothing in either module showing that it happened.
  if (existing.leadLink) return crmOwned(existing.leadLink.id);
  if (existing.status !== "open") {
    // Force a re-open first so closed_won side-effects are reversed
    // explicitly and we don't strand a LeadPulseDailyClose.
    return NextResponse.json({ error: "row_not_open" }, { status: 409 });
  }

  await prisma.leadPulsePipeline.delete({ where: { id: params.id } });
  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "pipeline_deleted",
      targetId: params.id,
      metadata: { ownerId: existing.userId },
    },
  });
  return NextResponse.json({ ok: true });
}
