import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess } from "@/lib/ops-rbac";
import { listTemplates } from "@/lib/ops-templates";
import { TemplatesClient } from "./client";

export const dynamic = "force-dynamic";

export default async function OperationsTemplatesPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = getOpsAccess(userId, perms);
  if (!access.canManageTemplates) {
    return (
      <>
        <TopBar title="Process Templates" subtitle="Operations" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Process templates are available to Operations managers only.
          </div>
        </div>
      </>
    );
  }

  const [templates, services] = await Promise.all([
    listTemplates(),
    prisma.service.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <TopBar title="Process Templates" subtitle="Define the steps for each service's process" />
      <div className="p-margin">
        <TemplatesClient templates={templates} services={services} />
      </div>
    </>
  );
}
