import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { AssignmentsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Assignments" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">No access.</p>
          </Section>
        </div>
      </>
    );
  }

  const [test, employees, assignmentsRaw] = await Promise.all([
    prisma.psychTest.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }),
    prisma.employee.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        empCode: true,
        name: true,
        designation: true,
        department: true,
      },
    }),
    prisma.psychAssignment.findMany({
      orderBy: { assignedAt: "desc" },
      include: {
        employee: { select: { id: true, name: true, empCode: true } },
        report: { select: { id: true } },
      },
    }),
  ]);

  // Latest assignment per employee for the chosen active test.
  const latestByEmp = new Map<string, (typeof assignmentsRaw)[number]>();
  for (const a of assignmentsRaw) {
    if (test && a.testId !== test.id) continue;
    if (!latestByEmp.has(a.employeeId)) latestByEmp.set(a.employeeId, a);
  }

  const rows = employees.map((e) => {
    const a = latestByEmp.get(e.id) ?? null;
    return {
      empId: e.id,
      empCode: e.empCode,
      name: e.name,
      designation: e.designation,
      department: e.department,
      assignmentId: a?.id ?? null,
      status: a?.status ?? "NOT_ASSIGNED",
      expiresAt: a?.expiresAt?.toISOString() ?? null,
      assignedAt: a?.assignedAt?.toISOString() ?? null,
      submittedAt: a?.submittedAt?.toISOString() ?? null,
      hasReport: Boolean(a?.report?.id),
    };
  });

  return (
    <>
      <TopBar
        title="Psychometric Assignments"
        subtitle={
          test
            ? `${test.name} · ${employees.length} employees`
            : "No active test cycle — seed one first"
        }
      />
      <div className="p-margin">
        <AssignmentsClient
          rows={rows}
          testId={test?.id ?? null}
          canEdit={canApproveHr(perms)}
        />
      </div>
    </>
  );
}
