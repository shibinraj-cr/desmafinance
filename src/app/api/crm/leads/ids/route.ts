import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { buildLeadWhere, leadOrderBy, leadFilterParamsFromQuery, leadSortFromQuery } from "@/lib/crm-leads";

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
  const baseWhere = buildLeadWhere(leadFilterParamsFromQuery(sp, { isBde: access.isBde, userId }));
  // Emailable = matching AND has a non-empty email.
  const emailableWhere: Prisma.LeadWhereInput = {
    AND: [baseWhere, { email: { not: null } }, { NOT: { email: "" } }],
  };

  const [total, emailable, rows] = await Promise.all([
    prisma.lead.count({ where: baseWhere }),
    prisma.lead.count({ where: emailableWhere }),
    prisma.lead.findMany({
      where: emailableWhere,
      orderBy: leadOrderBy(leadSortFromQuery(sp)),
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
