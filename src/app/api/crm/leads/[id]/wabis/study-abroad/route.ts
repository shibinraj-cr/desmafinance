import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { enqueueStudyAbroadWebhook } from "@/lib/crm-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/crm/leads/[id]/wabis/study-abroad
 *
 * Fires the study-abroad counsellor intro for one lead, via the assigned
 * consultant's `study_abroad` Wabis workflow. Backs the per-lead WhatsApp button
 * that only shows for study-abroad services (Service.isStudyAbroad).
 *
 * Only someone who can act on the lead may trigger it — the assigned BDE, a
 * supervisor, or an admin (canEditLead). The message always carries the ASSIGNED
 * consultant's name/number, whoever clicks, because that is who the candidate
 * should reach.
 */
export const POST = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      candidateName: true,
      email: true,
      phone: true,
      phoneE164: true,
      assignedToId: true,
      source: { select: { label: true } },
      service: { select: { name: true, isStudyAbroad: true } },
      status: { select: { label: true } },
      assignedTo: { select: { leadPulseRole: { select: { displayName: true, phone: true } } } },
    },
  });
  if (!lead) throw notFound();
  if (!canEditLead(access, lead, userId)) throw forbidden();

  if (!lead.service?.isStudyAbroad) {
    throw badRequest("This lead's service isn't a study-abroad service.", "not_study_abroad");
  }
  if (!lead.assignedToId) {
    throw badRequest("Assign a consultant to this lead first.", "unassigned");
  }

  const result = await enqueueStudyAbroadWebhook({
    leadId: lead.id,
    assigneeUserId: lead.assignedToId,
    candidateName: lead.candidateName,
    phone: lead.phoneE164 ?? lead.phone,
    email: lead.email,
    source: lead.source?.label,
    service: lead.service?.name,
    status: lead.status?.label,
    agentDisplayName: lead.assignedTo?.leadPulseRole?.displayName,
    agentPhone: lead.assignedTo?.leadPulseRole?.phone,
  });

  // The send outcome is a normal result, not an HTTP error — a "no endpoint" or
  // "already sent" is information the UI shows, not a failed request.
  return NextResponse.json(result);
});
