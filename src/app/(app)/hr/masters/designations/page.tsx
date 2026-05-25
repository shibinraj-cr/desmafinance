import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { DesignationsEditor } from "./client";

export const dynamic = "force-dynamic";

export default async function DesignationsPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Designations" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">No access.</p>
          </Section>
        </div>
      </>
    );
  }
  const rows = await prisma.hrDesignation.findMany({
    orderBy: [{ level: "desc" }, { name: "asc" }],
    include: { _count: { select: { employees: true } } },
  });
  return (
    <>
      <TopBar
        title="Designations"
        subtitle={`${rows.length} designation${rows.length === 1 ? "" : "s"} · seniority tier master`}
      />
      <div className="p-margin">
        <DesignationsEditor
          rows={rows.map((r) => ({
            id: r.id,
            name: r.name,
            level: r.level,
            active: r.active,
            count: r._count.employees,
          }))}
          canEdit={canApproveHr(perms)}
        />
      </div>
    </>
  );
}
