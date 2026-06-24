import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { recordLeadActivity } from "@/lib/crm-activity";
import { recordAudit } from "@/lib/audit";
import { normalizePhone, computeDedupeKey, emailKeyOf } from "@/lib/crm";
import { leadRowInclude, serializeLead, isActionOnlyStatus } from "@/lib/crm-leads";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

// ── GET /api/crm/leads/[id] ─────────────────────────────────────────────────
export const GET = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const lead = await prisma.lead.findUnique({ where: { id: params.id }, include: leadRowInclude });
  if (!lead) throw notFound();
  return NextResponse.json({
    lead: serializeLead(lead),
    canEdit: canEditLead(access, lead, userId),
  });
});

// ── PATCH /api/crm/leads/[id] — edit fields / change status ─────────────────
const PatchSchema = z.object({
  candidateName: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  altPhone: z.string().trim().max(60).nullable().optional(),
  sourceId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
  qualificationId: z.string().nullable().optional(),
  statusId: z.string().optional(),
  partyId: z.string().nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  studyDestination: z.string().trim().max(100).nullable().optional(),
  extra: z.record(z.string()).nullable().optional(),
});

const FIELD_LABELS: Record<string, string> = {
  candidateName: "Name",
  email: "Email",
  phone: "Phone",
  altPhone: "Alternative phone",
  sourceId: "Source",
  serviceId: "Service",
  qualificationId: "Qualification",
  country: "Country",
  studyDestination: "Study Destination",
  extra: "Extra info",
};

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);

  const existing = await prisma.lead.findUnique({
    where: { id: params.id },
    include: { status: { select: { id: true, label: true } } },
  });
  if (!existing) throw notFound();
  if (!canEditLead(access, existing, userId)) throw forbidden();

  const body = await req.json().catch(() => null);
  const d = PatchSchema.parse(body);

  // coerce "" → null for clearable string fields
  const clean = <T extends string | null | undefined>(v: T): string | null | undefined =>
    v === "" ? null : v;

  const update: Record<string, unknown> = {};
  const fieldDiff: Record<string, { from: unknown; to: unknown }> = {};

  if (d.candidateName !== undefined && d.candidateName !== existing.candidateName) {
    update.candidateName = d.candidateName;
    fieldDiff.candidateName = { from: existing.candidateName, to: d.candidateName };
  }
  if (d.email !== undefined && clean(d.email) !== existing.email) {
    update.email = clean(d.email);
    fieldDiff.email = { from: existing.email, to: clean(d.email) };
  }
  if (d.phone !== undefined && clean(d.phone) !== existing.phone) {
    update.phone = clean(d.phone);
    fieldDiff.phone = { from: existing.phone, to: clean(d.phone) };
  }
  if (d.altPhone !== undefined && clean(d.altPhone) !== existing.altPhone) {
    update.altPhone = clean(d.altPhone);
    fieldDiff.altPhone = { from: existing.altPhone, to: clean(d.altPhone) };
  }
  if (d.sourceId !== undefined && clean(d.sourceId) !== existing.sourceId) {
    update.sourceId = clean(d.sourceId);
    fieldDiff.sourceId = { from: existing.sourceId, to: clean(d.sourceId) };
  }
  if (d.serviceId !== undefined && clean(d.serviceId) !== existing.serviceId) {
    update.serviceId = clean(d.serviceId);
    fieldDiff.serviceId = { from: existing.serviceId, to: clean(d.serviceId) };
  }
  if (d.qualificationId !== undefined && clean(d.qualificationId) !== existing.qualificationId) {
    update.qualificationId = clean(d.qualificationId);
    fieldDiff.qualificationId = { from: existing.qualificationId, to: clean(d.qualificationId) };
  }
  if (d.country !== undefined && clean(d.country) !== existing.country) {
    update.country = clean(d.country);
    fieldDiff.country = { from: existing.country, to: clean(d.country) };
  }
  if (d.studyDestination !== undefined && clean(d.studyDestination) !== existing.studyDestination) {
    update.studyDestination = clean(d.studyDestination);
    fieldDiff.studyDestination = { from: existing.studyDestination, to: clean(d.studyDestination) };
  }
  if (d.extra !== undefined) {
    const next = d.extra ?? null;
    const prev = (existing.extra as Record<string, string> | null) ?? null;
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      // Prisma needs JsonNull (not undefined) to actually clear a nullable Json column.
      update.extra = next === null ? Prisma.JsonNull : next;
      fieldDiff.extra = { from: prev, to: next };
    }
  }

  // Recompute the normalized phone + dedupe key if email or phone changed.
  if ("email" in update || "phone" in update) {
    const finalEmail = "email" in update ? (update.email as string | null) : existing.email;
    const finalPhone = "phone" in update ? (update.phone as string | null) : existing.phone;
    const e164 = normalizePhone(finalPhone);
    update.phoneE164 = e164;
    update.emailKey = emailKeyOf(finalEmail);
    update.dedupeKey = computeDedupeKey(finalEmail, e164);
  }
  // Re-normalize the alternate number on change. It doesn't feed dedupe keys.
  if ("altPhone" in update) {
    update.altPhoneE164 = normalizePhone(update.altPhone as string | null);
  }

  // Party linkage.
  let partyLinked = false;
  if (d.partyId !== undefined && clean(d.partyId) !== existing.partyId) {
    const pid = clean(d.partyId);
    if (pid) {
      const party = await prisma.party.findUnique({ where: { id: pid }, select: { id: true } });
      if (!party) throw badRequest("Unknown party", "invalid_party");
    }
    update.partyId = pid;
    partyLinked = !!pid;
  }

  // Status change.
  let statusChange: { from: string; to: string } | null = null;
  if (d.statusId !== undefined && d.statusId !== existing.statusId) {
    const newStatus = await prisma.crmLeadStatus.findFirst({ where: { id: d.statusId, active: true } });
    if (!newStatus) throw badRequest("Unknown or inactive status", "invalid_status");
    if (isActionOnlyStatus(newStatus.code)) {
      throw badRequest(
        `"${newStatus.label}" is set by an action (Set deal / Enroll), not the status picker.`,
        "status_action_only",
      );
    }
    update.statusId = d.statusId;
    statusChange = { from: existing.status.label, to: newStatus.label };
  }

  if (Object.keys(update).length === 0) {
    const unchanged = await prisma.lead.findUnique({ where: { id: params.id }, include: leadRowInclude });
    return NextResponse.json({ lead: serializeLead(unchanged!) });
  }

  const updated = await prisma.lead.update({
    where: { id: params.id },
    data: update,
    include: leadRowInclude,
  });

  // Activity logging. recordLeadActivity bumps lastActivityAt.
  if (statusChange) {
    await recordLeadActivity({
      leadId: updated.id,
      actorId: userId,
      type: "STATUS_CHANGED",
      summary: `Status changed: ${statusChange.from} → ${statusChange.to}`,
      metadata: statusChange,
    });
  }
  if (Object.keys(fieldDiff).length > 0) {
    const fields = Object.keys(fieldDiff)
      .map((k) => FIELD_LABELS[k] ?? k)
      .join(", ");
    await recordLeadActivity({
      leadId: updated.id,
      actorId: userId,
      type: "FIELD_UPDATED",
      summary: `Updated ${fields}`,
      metadata: fieldDiff,
    });
  }
  if (partyLinked) {
    await recordLeadActivity({
      leadId: updated.id,
      actorId: userId,
      type: "PARTY_LINKED",
      summary: "Linked to candidate record",
      metadata: { partyId: update.partyId },
    });
  }

  return NextResponse.json({ lead: serializeLead(updated) });
});

// ── DELETE /api/crm/leads/[id] — admin only ─────────────────────────────────
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.isAdmin) throw forbidden();

  const existing = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, candidateName: true },
  });
  if (!existing) throw notFound();

  // Notes + activities cascade-delete with the lead.
  await prisma.lead.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "Lead",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { candidateName: existing.candidateName },
  });

  return NextResponse.json({ ok: true });
});
