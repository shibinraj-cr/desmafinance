import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, OPS_USER_ANCHORS } from "@/lib/ops-rbac";
import { opsProjectListInclude, serializeProjectRow } from "@/lib/ops-queries";
import { ProjectsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function OperationsProjectsPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = getOpsAccess(userId, perms);
  if (!access.canViewProjects) {
    return (
      <>
        <TopBar title="Projects" subtitle="Operations" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The Operations workspace is available to the operations team only.
          </div>
        </div>
      </>
    );
  }

  const [rows, services, opsUsers] = await Promise.all([
    prisma.opsProject.findMany({ include: opsProjectListInclude, orderBy: [{ lastActivityAt: "desc" }], take: 500 }),
    prisma.service.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    access.canAssign
      ? prisma.user.findMany({
          where: { roleRef: { pages: { hasSome: OPS_USER_ANCHORS } } },
          select: { id: true, username: true },
          orderBy: { username: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <TopBar title="Projects" subtitle="All candidate process projects" />
      <div className="p-margin">
        <ProjectsClient
          projects={rows.map((p) => serializeProjectRow(p))}
          services={services}
          opsUsers={opsUsers}
          canAssign={access.canAssign}
          currentUserId={userId}
        />
      </div>
    </>
  );
}
