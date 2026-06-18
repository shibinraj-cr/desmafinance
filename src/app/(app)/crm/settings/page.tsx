import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { SettingsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function CrmSettingsPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) {
    return (
      <>
        <TopBar title="CRM Settings" subtitle="Admin" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            CRM settings are available to administrators only.
          </div>
        </div>
      </>
    );
  }

  const [statuses, statusCounts, quals, qualCounts] = await Promise.all([
    prisma.crmLeadStatus.findMany({ orderBy: [{ displayOrder: "asc" }, { label: "asc" }] }),
    prisma.lead.groupBy({ by: ["statusId"], _count: true }),
    prisma.crmQualification.findMany({ orderBy: [{ displayOrder: "asc" }, { label: "asc" }] }),
    prisma.lead.groupBy({ by: ["qualificationId"], _count: true, where: { qualificationId: { not: null } } }),
  ]);
  const statusCountMap = new Map(statusCounts.map((c) => [c.statusId, c._count]));
  const qualCountMap = new Map(qualCounts.map((c) => [c.qualificationId, c._count]));

  return (
    <>
      <TopBar title="CRM Settings" subtitle="Lead statuses & qualifications" />
      <div className="p-margin space-y-lg">
        <SettingsClient
          statuses={statuses.map((s) => ({
            id: s.id,
            code: s.code,
            label: s.label,
            kind: s.kind,
            displayOrder: s.displayOrder,
            color: s.color,
            isDefault: s.isDefault,
            active: s.active,
            leadCount: statusCountMap.get(s.id) ?? 0,
          }))}
          qualifications={quals.map((q) => ({
            id: q.id,
            label: q.label,
            displayOrder: q.displayOrder,
            active: q.active,
            leadCount: qualCountMap.get(q.id) ?? 0,
          }))}
        />
      </div>
    </>
  );
}
