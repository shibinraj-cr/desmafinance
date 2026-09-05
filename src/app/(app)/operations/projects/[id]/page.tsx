import { redirect, notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, canEditProject, OPS_USER_ANCHORS } from "@/lib/ops-rbac";
import { opsProjectDetailInclude, serializeProjectDetail } from "@/lib/ops-queries";
import { ProjectDetailClient } from "./client";

export const dynamic = "force-dynamic";

export default async function OperationsProjectDetailPage({ params }: { params: { id: string } }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = getOpsAccess(userId, perms);
  if (!access.canViewProjects) redirect("/operations/my-work");

  const p = await prisma.opsProject.findUnique({ where: { id: params.id }, include: opsProjectDetailInclude });
  if (!p) notFound();

  const detail = serializeProjectDetail(p);
  const canEdit = canEditProject(access, { assignedToId: p.assignedToId }, userId);

  // Loaded for anyone who can edit — the owner dropdown (managers) and the
  // per-step task assignee picker (any editor) both draw from this list.
  const opsUsers = canEdit
    ? await prisma.user.findMany({
        where: { roleRef: { pages: { hasSome: OPS_USER_ANCHORS } } },
        select: { id: true, username: true },
        orderBy: { username: "asc" },
      })
    : [];

  return (
    <>
      <TopBar title={detail.candidateName} subtitle={`${detail.serviceName} · process`} />
      <div className="p-margin">
        <ProjectDetailClient
          project={detail}
          canEdit={canEdit}
          canAssign={access.canAssign}
          opsUsers={opsUsers}
        />
      </div>
    </>
  );
}
