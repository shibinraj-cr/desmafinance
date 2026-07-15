import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { employeeForUser } from "@/lib/hr-me";
import { MeNotifsClient, type NotifItem } from "./client";

export const dynamic = "force-dynamic";

export default async function MeNotificationsPage() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");

  // Unified personal inbox: HR announcements (Employee-scoped) + CRM
  // notifications (User-scoped). A CRM/BDE user with no Employee record still
  // sees their CRM items and the notification toggle.
  const [emp, crmRole, crmNotifs] = await Promise.all([
    employeeForUser(userId),
    prisma.leadPulseRole.findUnique({ where: { userId }, select: { notifyOnAssign: true } }),
    prisma.crmNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const hrReceipts = emp
    ? await prisma.hrNotificationReceipt.findMany({
        where: { employeeId: emp.id },
        orderBy: { notification: { createdAt: "desc" } },
        take: 100,
        include: { notification: true },
      })
    : [];

  const items: NotifItem[] = [
    ...hrReceipts.map((r) => ({
      source: "hr" as const,
      id: r.notificationId,
      title: r.notification.title,
      body: r.notification.body,
      kind: r.notification.kind,
      linkUrl: r.notification.linkUrl,
      requiresAck: r.notification.requiresAck,
      createdAt: r.notification.createdAt.toISOString(),
      readAt: r.readAt ? r.readAt.toISOString() : null,
      acknowledgedAt: r.acknowledgedAt ? r.acknowledgedAt.toISOString() : null,
    })),
    ...crmNotifs.map((n) => ({
      source: "crm" as const,
      id: n.id,
      title: n.title,
      body: n.body,
      kind: n.kind,
      linkUrl: n.linkUrl,
      requiresAck: false,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
      acknowledgedAt: null,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <>
      <TopBar title="Notifications" />
      <div className="p-margin">
        <MeNotifsClient
          items={items}
          crmPrefs={crmRole ? { notifyOnAssign: crmRole.notifyOnAssign } : null}
        />
      </div>
    </>
  );
}
