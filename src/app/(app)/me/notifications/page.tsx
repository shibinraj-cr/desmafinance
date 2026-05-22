import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { employeeForUser } from "@/lib/hr-me";
import { MeNotifsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function MeNotificationsPage() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");
  const emp = await employeeForUser(userId);
  if (!emp) {
    return (
      <>
        <TopBar title="Notifications" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">
              Your login isn't linked to an employee record yet.
            </p>
          </Section>
        </div>
      </>
    );
  }
  const receipts = await prisma.hrNotificationReceipt.findMany({
    where: { employeeId: emp.id },
    orderBy: { notification: { createdAt: "desc" } },
    take: 100,
    include: { notification: true },
  });
  return (
    <>
      <TopBar title="Notifications" />
      <div className="p-margin">
        <MeNotifsClient
          items={receipts.map((r) => ({
            id: r.notificationId,
            title: r.notification.title,
            body: r.notification.body,
            kind: r.notification.kind,
            linkUrl: r.notification.linkUrl,
            requiresAck: r.notification.requiresAck,
            createdAt: r.notification.createdAt.toISOString(),
            readAt: r.readAt ? r.readAt.toISOString() : null,
            acknowledgedAt: r.acknowledgedAt ? r.acknowledgedAt.toISOString() : null,
          }))}
        />
      </div>
    </>
  );
}
