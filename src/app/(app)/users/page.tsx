import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageUsers, roleLabel, roleBadgeClass } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { UserActions, NewUserButton } from "./client";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (!canManageUsers(session.user.role)) {
    return (
      <>
        <TopBar title="User Management" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              You need admin access to view this page.
            </div>
          </Section>
        </div>
      </>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  return (
    <>
      <TopBar
        title="User Management"
        subtitle={`${users.length} user${users.length === 1 ? "" : "s"}`}
        action={<NewUserButton />}
      />
      <div className="p-margin space-y-lg">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container-low text-on-surface-variant">
                <tr className="text-left">
                  <th className="px-md py-sm text-label-sm uppercase tracking-wider">Username</th>
                  <th className="px-md py-sm text-label-sm uppercase tracking-wider">Email</th>
                  <th className="px-md py-sm text-label-sm uppercase tracking-wider">Role</th>
                  <th className="px-md py-sm text-label-sm uppercase tracking-wider">Created</th>
                  <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-outline-variant/60">
                    <td className="px-md py-sm font-semibold">{u.username}</td>
                    <td className="px-md py-sm text-on-surface-variant">{u.email ?? "—"}</td>
                    <td className="px-md py-sm">
                      <span
                        className={
                          "px-sm py-xs rounded-full text-label-sm font-semibold " +
                          roleBadgeClass(u.role)
                        }
                      >
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="px-md py-sm text-on-surface-variant">
                      {u.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-md py-sm text-right">
                      <UserActions
                        userId={u.id}
                        username={u.username}
                        role={u.role}
                        isSelf={u.id === session.user.id}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
