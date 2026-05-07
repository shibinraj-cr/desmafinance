import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SideNav } from "@/components/SideNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  // Pending-approvals badge count for managers/admins. Other roles see 0.
  const pendingCount = await prisma.pendingApproval
    .count({ where: { status: "pending" } })
    .catch(() => 0);

  return (
    <div className="flex min-h-screen bg-surface">
      <SideNav
        user={{
          name: session.user.name,
          email: session.user.email,
          role: session.user.role,
        }}
        pendingCount={pendingCount}
      />
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}
