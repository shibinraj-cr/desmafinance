import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { activityInclude, serializeActivity, TIMELINE_HIDDEN_TYPES } from "@/lib/crm-leads";

export const dynamic = "force-dynamic";

// GET /api/crm/leads/[id]/activities?scope=timeline|history&actor=&type=&from=&to=
// - timeline (default): visible to anyone with CRM view access; trimmed metadata.
// - history: admin only; full log incl. opens, note before/after, mail/call detail.
export const GET = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const lead = await prisma.lead.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!lead) throw notFound();

  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") === "history" ? "history" : "timeline";
  if (scope === "history" && !access.canViewHistory) throw forbidden();

  const where: Prisma.LeadActivityWhereInput = { leadId: params.id };

  if (scope === "history") {
    const actor = sp.get("actor");
    const type = sp.get("type");
    const from = sp.get("from");
    const to = sp.get("to");
    if (actor) where.actorId = actor;
    if (type) where.type = type;
    if (from || to) {
      const occurredAt: Prisma.DateTimeFilter = {};
      if (from) occurredAt.gte = new Date(from);
      if (to) {
        const d = new Date(to);
        d.setUTCHours(23, 59, 59, 999); // match the app's UTC date boundaries (see lib/period.ts)
        occurredAt.lte = d;
      }
      where.occurredAt = occurredAt;
    }
  } else {
    where.type = { notIn: Array.from(TIMELINE_HIDDEN_TYPES) };
  }

  const activities = await prisma.leadActivity.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: scope === "history" ? 500 : 200,
    include: activityInclude,
  });

  return NextResponse.json({
    scope,
    activities: activities.map((a) => serializeActivity(a, { includeMetadata: scope === "history" })),
  });
});
