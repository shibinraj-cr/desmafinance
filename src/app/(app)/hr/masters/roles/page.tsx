import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { RolesEditor } from "./client";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Roles" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">No access.</p>
          </Section>
        </div>
      </>
    );
  }
  const rows = await prisma.hrRole.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } } },
  });
  return (
    <>
      <TopBar
        title="Roles"
        subtitle={`${rows.length} functional role${rows.length === 1 ? "" : "s"}`}
      />
      <div className="p-margin">
        <RolesEditor
          rows={rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            active: r.active,
            members: r._count.members,
          }))}
          canEdit={canApproveHr(perms)}
        />
      </div>
    </>
  );
}
