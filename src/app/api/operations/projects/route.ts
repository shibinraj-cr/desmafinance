import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess } from "@/lib/ops-rbac";
import { buildOpsProjectWhere, opsProjectListInclude, serializeProjectRow } from "@/lib/ops-queries";

export const dynamic = "force-dynamic";

// GET /api/operations/projects?status=&serviceId=&assignee=(me|unassigned|<id>)
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = getOpsAccess(userId, perms);
  if (!access.canViewProjects) throw forbidden();

  const url = new URL(req.url);
  const where = buildOpsProjectWhere({
    status: url.searchParams.get("status"),
    serviceId: url.searchParams.get("serviceId"),
    assignee: url.searchParams.get("assignee"),
    currentUserId: userId,
  });

  const rows = await prisma.opsProject.findMany({
    where,
    include: opsProjectListInclude,
    orderBy: [{ lastActivityAt: "desc" }],
    take: 500,
  });

  return NextResponse.json({ projects: rows.map((p) => serializeProjectRow(p)) });
});
