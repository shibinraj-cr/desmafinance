import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { APP_PAGES, ALL_PAGE_HREFS } from "@/lib/pages";
import { BANK_PAGE } from "@/lib/bank/access";

// A new role starts with every page ticked — except bank statements, which
// expose the company's bank transactions and must be granted on purpose.
const NEW_ROLE_DEFAULT_PAGES = ALL_PAGE_HREFS.filter((p) => p !== BANK_PAGE);
import { RolesEditor, NewRoleButton } from "./client";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canManageUsers(perms)) {
    return (
      <>
        <TopBar title="Role Management" />
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

  const roles = await prisma.role.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: { _count: { select: { users: true } } },
  });

  return (
    <>
      <TopBar
        title="Role Management"
        subtitle={`${roles.length} role${roles.length === 1 ? "" : "s"}`}
        action={<NewRoleButton allPages={APP_PAGES} defaultPages={NEW_ROLE_DEFAULT_PAGES} />}
      />
      <div className="p-margin space-y-lg">
        <RolesEditor
          roles={roles.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            isAdmin: r.isAdmin,
            canApprove: r.canApprove,
            needsApproval: r.needsApproval,
            pages: r.pages,
            isSystem: r.isSystem,
            userCount: r._count.users,
          }))}
          allPages={APP_PAGES}
        />
      </div>
    </>
  );
}
