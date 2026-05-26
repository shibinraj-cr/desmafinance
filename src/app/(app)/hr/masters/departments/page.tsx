import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { DepartmentsEditor } from "./client";

export const dynamic = "force-dynamic";

export default async function DepartmentsPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Departments" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">No access.</p>
          </Section>
        </div>
      </>
    );
  }
  const [rows, employees] = await Promise.all([
    prisma.hrDepartment.findMany({
      orderBy: { name: "asc" },
      include: {
        headEmployee: { select: { id: true, empCode: true, name: true } },
        _count: { select: { members: true } },
      },
    }),
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { empCode: "asc" },
      select: { id: true, empCode: true, name: true },
    }),
  ]);
  return (
    <>
      <TopBar
        title="Departments"
        subtitle={`${rows.length} department${rows.length === 1 ? "" : "s"}`}
      />
      <div className="p-margin">
        <DepartmentsEditor
          rows={rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            headEmployeeId: r.headEmployeeId,
            headLabel: r.headEmployee
              ? `${r.headEmployee.empCode} · ${r.headEmployee.name}`
              : null,
            active: r.active,
            members: r._count.members,
          }))}
          employees={employees}
          canEdit={canApproveHr(perms)}
        />
      </div>
    </>
  );
}
