import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { TopBar } from "@/components/TopBar";
import { CrmNotifsClient, type CrmNotifItem } from "./client";

export const dynamic = "force-dynamic";

export default async function CrmNotificationsPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  // Same gate as the nav (canSeePage): any CRM user who can see the Leads page.
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) redirect("/");

  const [crmRole, notifs] = await Promise.all([
    prisma.leadPulseRole.findUnique({ where: { userId }, select: { notifyOnAssign: true } }),
    prisma.crmNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const items: CrmNotifItem[] = notifs.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    kind: n.kind,
    linkUrl: n.linkUrl,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt ? n.readAt.toISOString() : null,
  }));

  return (
    <>
      <TopBar title="Notifications" subtitle="CRM" />
      <div className="p-margin">
        <CrmNotifsClient
          items={items}
          crmPrefs={crmRole ? { notifyOnAssign: crmRole.notifyOnAssign } : null}
        />
      </div>
    </>
  );
}
