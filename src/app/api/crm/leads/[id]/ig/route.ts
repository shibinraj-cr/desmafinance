import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { canSeeLeadInstagram } from "@/lib/ig/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MESSAGE_LIMIT = 200;

/**
 * GET /api/crm/leads/[id]/ig — the Instagram DMs behind a lead.
 *
 * Read-only: replies happen in Business Suite or the Instagram app, not here.
 * Scoped like a WhatsApp thread rather than like the lead — the messages are
 * the candidate's own words — so oversight roles and the lead's consultant see
 * them, and nobody else (see canSeeLeadInstagram).
 */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const lead = await prisma.lead.findUnique({ where: { id: params.id }, select: { id: true, assignedToId: true } });
  if (!lead) throw notFound();
  if (!canSeeLeadInstagram(access, perms, lead, userId)) throw forbidden();

  const contacts = await prisma.igContact.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      username: true,
      name: true,
      leadCreated: true,
      messages: {
        // Newest slice, put back in reading order below.
        orderBy: { occurredAt: "desc" },
        take: MESSAGE_LIMIT,
        select: { id: true, direction: true, sender: true, body: true, attachmentType: true, sendStatus: true, occurredAt: true },
      },
    },
  });

  return NextResponse.json({
    contacts: contacts.map((c) => ({
      id: c.id,
      username: c.username,
      name: c.name,
      leadCreated: c.leadCreated,
      messages: [...c.messages].reverse(),
    })),
  });
});
