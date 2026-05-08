import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { SideNav } from "@/components/SideNav";
import { RouteProgress } from "@/components/RouteProgress";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, perms } = await getCurrentUserAndPermissions();
  if (!session?.user || !perms) redirect("/login");

  // Pending-approvals badge count for managers/admins.
  const pendingCount = await prisma.pendingApproval
    .count({ where: { status: "pending" } })
    .catch(() => 0);

  return (
    // flex-col on mobile so the mobile top bar stacks above main; flex-row
    // on md+ so the desktop sidebar sits to the left of main.
    <div className="flex flex-col md:flex-row min-h-screen bg-surface">
      <RouteProgress />
      <SideNav
        user={{ name: session.user.name, email: session.user.email }}
        perms={perms}
        pendingCount={pendingCount}
      />
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}
