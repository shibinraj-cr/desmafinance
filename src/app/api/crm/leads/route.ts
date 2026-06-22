import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { recordLeadActivity } from "@/lib/crm-activity";
import { normalizePhone, computeDedupeKey, emailKeyOf } from "@/lib/crm";
import { parsePeriod, rangeFor } from "@/lib/period";
import {
  leadRowInclude,
  serializeLead,
  resolveDefaultStatus,
  getDuplicateStatus,
  buildLeadWhere,
  leadOrderBy,
  isActiveBde,
  assignedDayRange,
} from "@/lib/crm-leads";

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

  const range = rangeFor(
    parsePeriod({
      period: sp.get("period") || undefined,
      from: sp.get("from") || undefined,
      to: sp.get("to") || undefined,
    }),
  );
  const assigned = assignedDayRange(sp.get("assignedOn") || undefined);
  const where = buildLeadWhere({
    status: sp.get("status") || undefined,
    source: sp.get("source") || undefined,
    service: sp.get("service") || undefined,
    assignee: sp.get("assignee") || undefined,
    campaign: sp.get("campaign") || undefined,
    q: sp.get("q") || undefined,
    from: range.from,
    to: range.to,
    assignedFrom: assigned?.from,
    assignedTo: assigned?.to,
  });
  const orderBy = leadOrderBy(sp.get("sort") || undefined);

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
  sourceId: z.string().optional(),
  serviceId: z.string().optional(),
  qualificationId: z.string().optional(),
  statusId: z.string().optional(),
  assignedToId: z.string().optional(),
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
  const emailKey = emailKeyOf(email);
  const dedupeKey = computeDedupeKey(email, phoneE164); // legacy provenance key

  // Resolve the starting status. Non-default unless an explicit valid status is
  // provided; flipped to "Duplicate" below if a matching lead already exists.
  let statusId = data.statusId;
  if (statusId) {
    const exists = await prisma.crmLeadStatus.findFirst({ where: { id: statusId, active: true } });
    if (!exists) throw badRequest("Unknown or inactive status", "invalid_status");
  } else {
    const def = await resolveDefaultStatus();
    if (!def) throw badRequest("No lead statuses configured — run db:seed-crm", "no_status_configured");
    statusId = def.id;
  }

  // Duplicate detection. We only treat the lead as "flagged duplicate" when the
  // Duplicate status is actually applied, so the activity/response can't claim a
  // flag that the visible status contradicts.
  let duplicateOfId: string | null = null;
  let duplicateFlagged = false;
  // Match an existing lead on email OR phone, independently — either collision
  // means the new lead is a likely duplicate.
  const dupOr: ({ emailKey: string } | { phoneE164: string })[] = [];
  if (emailKey) dupOr.push({ emailKey });
  if (phoneE164) dupOr.push({ phoneE164 });
  if (dupOr.length) {
    const dup = await prisma.lead.findFirst({
      where: { OR: dupOr },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (dup) {
      duplicateOfId = dup.id;
      const dupStatus = await getDuplicateStatus();
      if (dupStatus && dupStatus.active) {
        statusId = dupStatus.id;
        duplicateFlagged = true;
      }
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

  const created = await prisma.lead.create({
    data: {
      candidateName: data.candidateName,
      email,
      phone,
      phoneE164,
      emailKey,
      dedupeKey,
      sourceId: data.sourceId || null,
      serviceId: data.serviceId || null,
      qualificationId: data.qualificationId || null,
      statusId,
      assignedToId,
      assignedAt: assignedToId ? new Date() : null,
      extra: data.extra ?? undefined,
      createdById: userId,
    },
    include: leadRowInclude,
  });

  await recordLeadActivity({
    leadId: created.id,
    actorId: userId,
    type: "LEAD_CREATED",
    summary: duplicateFlagged ? "Lead created (flagged as duplicate)" : "Lead created",
    metadata: duplicateOfId ? { duplicateOf: duplicateOfId, flaggedDuplicate: duplicateFlagged } : undefined,
  });
  if (assignedToId) {
    await recordLeadActivity({
      leadId: created.id,
      actorId: userId,
      type: "ASSIGNED",
      summary: `Assigned to ${created.assignedTo?.leadPulseRole?.displayName ?? created.assignedTo?.username ?? "consultant"}`,
      metadata: { toUserId: assignedToId },
    });
  }

  return NextResponse.json(
    { lead: serializeLead(created), duplicateOf: duplicateFlagged ? duplicateOfId : null },
    { status: 201 },
  );
});
