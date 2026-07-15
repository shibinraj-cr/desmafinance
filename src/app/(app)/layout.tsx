import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { countNewLeadsAssignedTo } from "@/lib/crm-leads";
import { countUnreadNotifications } from "@/lib/notifications";
import { SideNav } from "@/components/SideNav";
import { GroupTabs } from "@/components/GroupTabs";
import { RouteProgress } from "@/components/RouteProgress";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, perms, userId } = await getCurrentUserAndPermissions();
  if (!session?.user || !perms || !userId) redirect("/login");

  // Pending-approvals badge count for managers/admins.
  // Rejected-queue count for the signed-in user (their own rejections
  // they haven't resubmitted or dismissed yet).
  // New-leads count: fresh leads assigned to the signed-in BDE, for the CRM
  // nav badge (0 for anyone with no fresh assigned leads).
  // Unread-notifications count: HR announcements + CRM notifications for the
  // signed-in user, for the /me/notifications nav badge.
  const [pendingCount, rejectedCount, newLeadsCount, notifCount] = await Promise.all([
    prisma.pendingApproval.count({ where: { status: "pending" } }).catch(() => 0),
    prisma.pendingApproval
      .count({ where: { status: "rejected", submittedById: userId } })
      .catch(() => 0),
    countNewLeadsAssignedTo(userId),
    countUnreadNotifications(userId),
  ]);

  return (
    // flex-col on mobile so the mobile top bar stacks above main; flex-row
    // on md+ so the desktop sidebar sits to the left of main.
    <div className="flex flex-col md:flex-row min-h-screen bg-surface">
      <RouteProgress />
      <SideNav
        user={{ name: session.user.name, email: session.user.email }}
        perms={perms}
        pendingCount={pendingCount}
        rejectedCount={rejectedCount}
        newLeadsCount={newLeadsCount}
        notifCount={notifCount}
      />
      <main className="flex-1 min-w-0 flex flex-col">
        <GroupTabs
          perms={perms}
          pendingCount={pendingCount}
          rejectedCount={rejectedCount}
          newLeadsCount={newLeadsCount}
          notifCount={notifCount}
        />
        {children}
      </main>
    </div>
  );
}
