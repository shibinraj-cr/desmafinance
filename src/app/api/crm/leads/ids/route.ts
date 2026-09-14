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

// GET /api/crm/leads/ids — ids of the leads matching the current filter, for
// "select all N matching" in the Leads list's bulk actions.
//
//   ?scope=all        every matching lead (backs bulk "Change stage")
//   ?scope=emailable  only those with an email address (backs bulk email)
//
// `emailable` is always returned alongside `total` so the caller can say how
// many of an all-scope selection the email action would skip. Each scope is
// gated by the action it backs, so neither capability grants the other's reach.
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);

  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") === "all" ? "all" : "emailable";
  if (scope === "all" ? !(access.canBulkStatus || access.canBulkEmail) : !access.canBulkEmail) {
    throw forbidden();
  }

  const baseWhere = buildLeadWhere(leadFilterParamsFromQuery(sp, { isBde: access.isBde, userId }));
  // Emailable = matching AND has a non-empty email.
  const emailableWhere: Prisma.LeadWhereInput = {
    AND: [baseWhere, { email: { not: null } }, { NOT: { email: "" } }],
  };
  const idWhere = scope === "all" ? baseWhere : emailableWhere;

  const [total, emailable, rows] = await Promise.all([
    prisma.lead.count({ where: baseWhere }),
    prisma.lead.count({ where: emailableWhere }),
    prisma.lead.findMany({
      where: idWhere,
      orderBy: leadOrderBy(leadSortFromQuery(sp)),
      take: MAX_IDS,
      select: { id: true },
    }),
  ]);

  return NextResponse.json({
    scope,
    ids: rows.map((r) => r.id),
    emailable,
    total,
    truncated: (scope === "all" ? total : emailable) > rows.length,
  });
});
