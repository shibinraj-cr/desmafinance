import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import {
  buildCrmTaskWhere,
  crmTaskListInclude,
  crmTaskListOrderBy,
  serializeCrmTaskListRow,
  resolveAssigneeFilter,
} from "@/lib/crm-leads";

export const dynamic = "force-dynamic";

const MAX_ROWS = 500;

/**
 * GET /api/crm/tasks — the cross-lead task board as JSON (the mobile Tasks
 * screen). Same filters/defaults as the CSV export route: no status → open,
 * status=all → every status; a BDE defaults to their own tasks.
 */
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const sp = new URL(req.url).searchParams;
  const statusParam = sp.get("status") || undefined;
  const status = statusParam === "all" ? undefined : statusParam ?? "open";

  const where = buildCrmTaskWhere({
    status,
    assignee: resolveAssigneeFilter(sp.get("assignee") || undefined, {
      isBde: access.isBde,
      userId,
    }),
    priority: sp.get("priority") || undefined,
    due: sp.get("due") || undefined,
    kind: sp.get("kind") || undefined,
    q: sp.get("q") || undefined,
    now: new Date(),
  });

  const rows = await prisma.crmTask.findMany({
    where,
    orderBy: crmTaskListOrderBy(sp.get("sort") || undefined),
    take: MAX_ROWS,
    include: crmTaskListInclude,
  });

  return NextResponse.json({ tasks: rows.map(serializeCrmTaskListRow) });
});
