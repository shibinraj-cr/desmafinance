import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { recordLeadActivity } from "@/lib/crm-activity";
import { notifyLeadAssigned } from "@/lib/crm-notify";
import { normalizePhone, computeDedupeKey, emailKeyOf, phoneMatchKeys, LEAD_TEMPERATURE_VALUES, QUALIFICATION_OTHER_MAX } from "@/lib/crm";
import { parseDobInput } from "@/lib/age";
import {
  leadRowInclude,
  serializeLead,
  resolveDefaultStatus,
  buildLeadWhere,
  leadFilterParamsFromQuery,
  leadSortFromQuery,
  leadOrderBy,
  isActiveBde,
  isActionOnlyStatus,
  isCentralisedStatus,
  resolveQualificationOther,
} from "@/lib/crm-leads";
import { recordReInquiry, resolveReInquiryContext, notifySupervisorOfReInquiries } from "@/lib/crm-reinquiry";

export const dynamic = "force-dynamic";

// ── GET /api/crm/leads — filtered, sorted, paginated list ───────────────────
// Everyone with CRM view access sees ALL leads (not filtered by assignee).
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") || "50", 10) || 50));

  const where = buildLeadWhere(leadFilterParamsFromQuery(sp, { isBde: access.isBde, userId }));
  const orderBy = leadOrderBy(leadSortFromQuery(sp));

  const [rows, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: leadRowInclude,
    }),
    prisma.lead.count({ where }),
  ]);

  return NextResponse.json({ leads: rows.map(serializeLead), total, page, pageSize });
});

// ── POST /api/crm/leads — create one lead ───────────────────────────────────
const CreateSchema = z.object({
  candidateName: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(60).optional(),
  altPhone: z.string().trim().max(60).optional(),
  sourceId: z.string().optional(),
  serviceId: z.string().optional(),
  qualificationId: z.string().optional(),
  // Free text for the "Others" qualification. Ignored (stored as null) unless
  // the chosen qualification is actually the catch-all — see
  // resolveQualificationOther, which the client cannot talk its way around.
  qualificationOther: z.string().trim().max(QUALIFICATION_OTHER_MAX).optional(),
  statusId: z.string().optional(),
  /** Cross-stage status; falls back to the default status when not given. */
  subStatusId: z.string().optional(),
  assignedToId: z.string().optional(),
  // Official date of birth as YYYY-MM-DD (age is derived, never sent).
  dob: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD").optional(),
  ),
  country: z.string().trim().max(100).optional(),
  studyDestination: z.string().trim().max(100).optional(),
  // Hot / Warm / Cold rating. "" is treated as "unset".
  temperature: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(LEAD_TEMPERATURE_VALUES as [string, ...string[]]).optional(),
  ),
  extra: z.record(z.string()).optional(),
});

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canCreateLeads) throw forbidden();

  const body = await req.json().catch(() => null);
  const data = CreateSchema.parse(body);

  const email = data.email || null;
  const phone = data.phone || null;
  const phoneE164 = normalizePhone(phone);
  // Secondary number — normalised for tel/wa.me links, search, AND duplicate
  // detection (its E.164 joins the phone identity set used for matching below).
  const altPhone = data.altPhone || null;
  const altPhoneE164 = normalizePhone(altPhone);
  const emailKey = emailKeyOf(email);
  const dedupeKey = computeDedupeKey(email, phoneE164); // legacy provenance key

  // Resolve the starting status (explicit valid status, else the default).
  let statusId = data.statusId;
  // Kept for the assignment rule below: a lead born in the central pool has no
  // consultant, the same as one moved there (see PATCH /api/crm/leads/[id]).
  let startingStatus: { code: string; label: string };
  if (statusId) {
    const exists = await prisma.crmLeadStatus.findFirst({ where: { id: statusId, active: true } });
    if (!exists) throw badRequest("Unknown or inactive status", "invalid_status");
    startingStatus = exists;
    // Action-only statuses (Pipeline / Enrolled / Duplicate) are set by an action
    // (Set deal / Enroll / import dedup), never by direct create. Mirrors the
    // PATCH guard so a lead can't be born in an action-only stage.
    if (isActionOnlyStatus(exists.code)) {
      throw badRequest(
        `"${exists.label}" is set by an action (Set deal / Enroll), not at creation.`,
        "status_action_only",
      );
    }
  } else {
    const def = await resolveDefaultStatus();
    if (!def) throw badRequest("No lead statuses configured — run db:seed-crm", "no_status_configured");
    statusId = def.id;
    startingStatus = def;
  }

  // Re-inquiry: if this candidate already exists (email OR any phone), DON'T
  // create a new row. Fold the submission onto the canonical lead (bump inquiry
  // count, log RE_INQUIRY, revive if it was lost, raise tasks) and return it.
  // Phones are matched as a set: this submission's primary/alternate numbers are
  // checked against BOTH the existing leads' primary and alternate numbers.
  const phoneKeys = phoneMatchKeys(phoneE164, altPhoneE164);
  const dupOr: Prisma.LeadWhereInput[] = [];
  if (emailKey) dupOr.push({ emailKey });
  if (phoneKeys.length) {
    dupOr.push({ phoneE164: { in: phoneKeys } });
    dupOr.push({ altPhoneE164: { in: phoneKeys } });
  }
  if (dupOr.length) {
    const dup = await prisma.lead.findFirst({
      where: { OR: dupOr },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (dup) {
      const ctx = await resolveReInquiryContext();
      const campaign = data.extra && typeof (data.extra as Record<string, unknown>).campaign === "string"
        ? ((data.extra as Record<string, unknown>).campaign as string)
        : null;
      const outcome = await recordReInquiry({ leadId: dup.id, source: "Manual entry", campaign, actorId: userId }, ctx);
      if (outcome) await notifySupervisorOfReInquiries([outcome], ctx, new URL(req.url).origin);
      const existing = await prisma.lead.findUnique({ where: { id: dup.id }, include: leadRowInclude });
      return NextResponse.json({ lead: serializeLead(existing!), reInquiry: true, duplicateOf: dup.id }, { status: 200 });
    }
  }

  // Assignment: admins may assign to any active BDE; a creating BDE owns their lead.
  let assignedToId: string | null = null;
  if (access.canAssign) {
    assignedToId = data.assignedToId || null;
    if (assignedToId && !(await isActiveBde(assignedToId))) {
      throw badRequest("Assignee must be an active L1/L2 BDE", "invalid_assignee");
    }
  } else if (access.isBde) {
    assignedToId = userId;
  }
  // The central pool is ownerless: a lead created straight into Centralised
  // (Re-)marketing gets no consultant, whoever was picked and whoever is
  // creating it. Without this a lead could be born in the state the stage
  // change exists to prevent — and the assignment would fire the candidate's
  // WhatsApp introduction from a consultant who is not going to work them.
  if (isCentralisedStatus(startingStatus)) assignedToId = null;

  const qualificationOther = await resolveQualificationOther(
    data.qualificationId || null,
    data.qualificationOther,
  );

  // Every lead carries a status from the moment it exists — an unset one would
  // read as "nobody has looked at this" and make the filter lie. Falls back to
  // the `isDefault` row ("Not contacted yet"), mirroring how the stage defaults.
  const subStatusId =
    data.subStatusId ||
    (
      await prisma.crmLeadSubStatus.findFirst({
        where: { isDefault: true, active: true },
        select: { id: true },
      })
    )?.id ||
    null;

  const created = await prisma.lead.create({
    data: {
      candidateName: data.candidateName,
      email,
      phone,
      phoneE164,
      altPhone,
      altPhoneE164,
      emailKey,
      dedupeKey,
      sourceId: data.sourceId || null,
      serviceId: data.serviceId || null,
      qualificationId: data.qualificationId || null,
      qualificationOther,
      statusId,
      subStatusId,
      subStatusSince: subStatusId ? new Date() : null,
      assignedToId,
      assignedAt: assignedToId ? new Date() : null,
      dob: parseDobInput(data.dob) ?? null,
      country: data.country || null,
      studyDestination: data.studyDestination || null,
      temperature: data.temperature ?? null,
      extra: data.extra ?? undefined,
      createdById: userId,
    },
    include: leadRowInclude,
  });

  await recordLeadActivity({
    leadId: created.id,
    actorId: userId,
    type: "LEAD_CREATED",
    summary: "Lead created",
  });
  if (assignedToId) {
    await recordLeadActivity({
      leadId: created.id,
      actorId: userId,
      type: "ASSIGNED",
      summary: `Assigned to ${created.assignedTo?.leadPulseRole?.displayName ?? created.assignedTo?.username ?? "consultant"}`,
      metadata: { toUserId: assignedToId },
    });
    // In-app notify the owner (best-effort; no-op when a BDE self-owns the lead).
    await notifyLeadAssigned({
      assigneeUserId: assignedToId,
      actorUserId: userId,
      leadId: created.id,
      candidateName: created.candidateName,
      isReassignment: false,
    });
  }

  return NextResponse.json(
    { lead: serializeLead(created), duplicateOf: null },
    { status: 201 },
  );
});
