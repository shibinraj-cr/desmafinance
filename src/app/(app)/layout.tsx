import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { countNewLeadsAssignedTo } from "@/lib/crm-leads";
import { countUnreadCrmNotifications } from "@/lib/crm-notify";
import { myTasksWhere } from "@/lib/ops-action-items";
import { countUnreadNews } from "@/lib/news/read";
import { SideNav } from "@/components/SideNav";
import { GroupTabs } from "@/components/GroupTabs";
import { RouteProgress } from "@/components/RouteProgress";
import { AppLauncher } from "@/components/AppLauncher";
import { UsageTracker } from "@/components/UsageTracker";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, perms, userId } = await getCurrentUserAndPermissions();
  if (!session?.user || !perms || !userId) redirect("/login");

  // Pending-approvals badge count for managers/admins.
  // Rejected-queue count for the signed-in user (their own rejections
  // they haven't resubmitted or dismissed yet).
  // New-leads count: fresh leads assigned to the signed-in BDE, for the CRM
  // nav badge (0 for anyone with no fresh assigned leads).
  // Open-tasks badge: the signed-in user's still-open ad-hoc operations tasks,
  // for the "My Tasks" nav item (0 for anyone with none). Same `myTasksWhere`
  // the page itself uses, so the badge and the folder always agree.
  // Unread CRM notifications for the signed-in user, for the CRM
  // "Notifications" nav badge (0 for anyone with none).
  // Unread News & Updates: company-wide, so this one is badged in the header
  // rather than the nav list — it has to be visible from every module.
  const [pendingCount, rejectedCount, newLeadsCount, myOpenTasksCount, crmNotifCount, newsUnreadCount] =
    await Promise.all([
      prisma.pendingApproval.count({ where: { status: "pending" } }).catch(() => 0),
      prisma.pendingApproval
        .count({ where: { status: "rejected", submittedById: userId } })
        .catch(() => 0),
      countNewLeadsAssignedTo(userId),
      prisma.opsActionItem.count({ where: { ...myTasksWhere(userId), status: "open" } }).catch(() => 0),
      countUnreadCrmNotifications(userId),
      countUnreadNews(userId),
    ]);

  return (
    // flex-col on mobile so the mobile top bar stacks above main; flex-row
    // on md+ so the desktop sidebar sits to the left of main.
    <div className="flex flex-col md:flex-row min-h-screen bg-surface">
      <RouteProgress />
      <UsageTracker />
      <AppLauncher
        perms={perms}
        userName={session.user.name}
        newsUnreadCount={newsUnreadCount}
      />
      <SideNav
        user={{ name: session.user.name, email: session.user.email }}
        perms={perms}
        pendingCount={pendingCount}
        rejectedCount={rejectedCount}
        newLeadsCount={newLeadsCount}
        myOpenTasksCount={myOpenTasksCount}
        crmNotifCount={crmNotifCount}
        newsUnreadCount={newsUnreadCount}
      />
      <main className="flex-1 min-w-0 flex flex-col">
        <GroupTabs
          perms={perms}
          pendingCount={pendingCount}
          rejectedCount={rejectedCount}
          newLeadsCount={newLeadsCount}
          myOpenTasksCount={myOpenTasksCount}
          crmNotifCount={crmNotifCount}
          newsUnreadCount={newsUnreadCount}
        />
        {children}
      </main>
    </div>
  );
}
