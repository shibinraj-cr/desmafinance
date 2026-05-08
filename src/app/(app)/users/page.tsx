import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageUsers, roleBadgeClass, roleLabel } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { UserActions, NewUserButton } from "./client";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) redirect("/login");
  if (!canManageUsers(perms)) {
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

  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        roleId: true,
        roleRef: { select: { id: true, name: true } },
        createdAt: true,
      },
    }),
    prisma.role.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <TopBar
        title="User Management"
        subtitle={`${users.length} user${users.length === 1 ? "" : "s"}`}
        action={<NewUserButton roles={roles} />}
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
                {users.map((u) => {
                  const displayRole = u.roleRef?.name ?? roleLabel(u.role);
                  return (
                    <tr key={u.id} className="border-t border-outline-variant/60">
                      <td className="px-md py-sm font-semibold">{u.username}</td>
                      <td className="px-md py-sm text-on-surface-variant">{u.email ?? "—"}</td>
                      <td className="px-md py-sm">
                        <span
                          className={
                            "px-sm py-xs rounded-full text-label-sm font-semibold " +
                            roleBadgeClass(displayRole)
                          }
                        >
                          {displayRole}
                        </span>
                      </td>
                      <td className="px-md py-sm text-on-surface-variant">
                        {u.createdAt.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-md py-sm text-right">
                        <UserActions
                          userId={u.id}
                          username={u.username}
                          currentRoleId={u.roleId ?? null}
                          isSelf={u.id === userId}
                          roles={roles}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
