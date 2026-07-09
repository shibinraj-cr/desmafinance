import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { parseAgeParam } from "@/lib/age";
import { parsePeriod, rangeFor } from "@/lib/period";
import { buildLeadWhere, leadOrderBy, assignedDayRange, resolveAssigneeFilter } from "@/lib/crm-leads";

export const dynamic = "force-dynamic";

// Upper bound on ids returned for a "select all matching" bulk action. Far above
// the daily send cap, so it never silently hides emailable leads in practice.
const MAX_IDS = 5000;

// GET /api/crm/leads/ids — ids of the leads matching the current filter that
// have an email address (used by "select all N matching" in bulk email). Admin-
// only, since it only backs the admin bulk-email flow.
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkEmail) throw forbidden();

  const sp = new URL(req.url).searchParams;
  const range = rangeFor(
    parsePeriod({ period: sp.get("period") || undefined, from: sp.get("from") || undefined, to: sp.get("to") || undefined }),
  );
  const assigned = assignedDayRange(sp.get("assignedOn") || undefined);
  const baseWhere = buildLeadWhere({
    status: sp.get("status") || undefined,
    source: sp.get("source") || undefined,
    service: sp.get("service") || undefined,
    assignee: resolveAssigneeFilter(sp.get("assignee") || undefined, { isBde: access.isBde, userId }),
    campaign: sp.get("campaign") || undefined,
    country: sp.get("country") || undefined,
    studyDestination: sp.get("studyDestination") || undefined,
    ageMin: parseAgeParam(sp.get("ageMin")),
    ageMax: parseAgeParam(sp.get("ageMax")),
    q: sp.get("q") || undefined,
    from: range.from,
    to: range.to,
    assignedFrom: assigned?.from,
    assignedTo: assigned?.to,
  });
  // Emailable = matching AND has a non-empty email.
  const emailableWhere: Prisma.LeadWhereInput = {
    AND: [baseWhere, { email: { not: null } }, { NOT: { email: "" } }],
  };

  const [total, emailable, rows] = await Promise.all([
    prisma.lead.count({ where: baseWhere }),
    prisma.lead.count({ where: emailableWhere }),
    prisma.lead.findMany({
      where: emailableWhere,
      orderBy: leadOrderBy(sp.get("sort") || undefined),
      take: MAX_IDS,
      select: { id: true },
    }),
  ]);

  return NextResponse.json({
    ids: rows.map((r) => r.id),
    emailable,
    total,
    truncated: emailable > rows.length,
  });
});
