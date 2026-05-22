import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { NotificationsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HrNotificationsPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Notifications" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }
  const notifs = await prisma.hrNotification.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      _count: { select: { receipts: true } },
      receipts: { select: { readAt: true, acknowledgedAt: true } },
    },
  });
  return (
    <>
      <TopBar title="Notifications" />
      <div className="p-margin">
        <NotificationsClient
          notifs={notifs.map((n) => ({
            id: n.id,
            title: n.title,
            body: n.body,
            linkUrl: n.linkUrl,
            kind: n.kind,
            requiresAck: n.requiresAck,
            createdAt: n.createdAt.toISOString(),
            total: n._count.receipts,
            read: n.receipts.filter((r) => r.readAt).length,
            acked: n.receipts.filter((r) => r.acknowledgedAt).length,
          }))}
          canBroadcast={canApproveHr(perms)}
        />
      </div>
    </>
  );
}
