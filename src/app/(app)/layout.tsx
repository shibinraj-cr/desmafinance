import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { countNewLeadsAssignedTo } from "@/lib/crm-leads";
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
  // Open-tasks badge: ad-hoc operations tasks assigned to the signed-in user
  // and not yet done, for the "My Tasks" nav item (0 for anyone with none).
  const [pendingCount, rejectedCount, newLeadsCount, myOpenTasksCount] = await Promise.all([
    prisma.pendingApproval.count({ where: { status: "pending" } }).catch(() => 0),
    prisma.pendingApproval
      .count({ where: { status: "rejected", submittedById: userId } })
      .catch(() => 0),
    countNewLeadsAssignedTo(userId),
    prisma.opsActionItem.count({ where: { assignedToId: userId, status: "open" } }).catch(() => 0),
  ]);

  return (
    // flex-col on mobile so the mobile top bar stacks above main; flex-row
    // on md+ so the desktop sidebar sits to the left of main.
    <div className="flex flex-col md:flex-row min-h-screen bg-surface">
      <RouteProgress />
      <UsageTracker />
      <AppLauncher perms={perms} userName={session.user.name} />
      <SideNav
        user={{ name: session.user.name, email: session.user.email }}
        perms={perms}
        pendingCount={pendingCount}
        rejectedCount={rejectedCount}
        newLeadsCount={newLeadsCount}
        myOpenTasksCount={myOpenTasksCount}
      />
      <main className="flex-1 min-w-0 flex flex-col">
        <GroupTabs
          perms={perms}
          pendingCount={pendingCount}
          rejectedCount={rejectedCount}
          newLeadsCount={newLeadsCount}
          myOpenTasksCount={myOpenTasksCount}
        />
        {children}
      </main>
    </div>
  );
}
