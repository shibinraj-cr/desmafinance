import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageUsers, roleBadgeClass, roleLabel } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import {
  UsersTable,
  NewUserButton,
  ResetPlaceholderPasswordsButton,
  LinkPlaceholderRolesButton,
  SetupMarketingAdminButton,
} from "./client";

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
        isActive: true,
        roleRef: { select: { id: true, name: true } },
        createdAt: true,
      },
    }),
    prisma.role.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  const rows = users.map((u) => {
    const displayRole = u.roleRef?.name ?? roleLabel(u.role);
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      displayRole,
      badgeClass: roleBadgeClass(displayRole),
      created: u.createdAt.toISOString().slice(0, 10),
      isActive: u.isActive,
      roleId: u.roleId ?? null,
    };
  });
  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <>
      <TopBar
        title="User Management"
        subtitle={`${activeCount} active${
          rows.length !== activeCount ? ` · ${rows.length} total` : ""
        }`}
        action={<NewUserButton roles={roles} />}
      />
      <div className="p-margin space-y-lg">
        <SetupMarketingAdminButton />
        <LinkPlaceholderRolesButton />
        <ResetPlaceholderPasswordsButton />
        <UsersTable rows={rows} roles={roles} currentUserId={userId} />
      </div>
    </>
  );
}
