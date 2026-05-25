import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";

export const dynamic = "force-dynamic";

export default async function OrgChartPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Org Chart" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">No access.</p>
          </Section>
        </div>
      </>
    );
  }

  const [departments, employees, designations] = await Promise.all([
    prisma.hrDepartment.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: {
        headEmployee: { select: { id: true, empCode: true, name: true } },
      },
    }),
    prisma.employee.findMany({
      where: { active: true },
      include: {
        designationRef: true,
        departments: { include: { department: true } },
        roleMemberships: { include: { role: true } },
      },
    }),
    prisma.hrDesignation.findMany({ orderBy: { level: "desc" } }),
  ]);

  // Bucket employees by department (using primary department first; fall
  // back to first available membership).
  type EmpView = {
    id: string;
    empCode: string;
    name: string;
    designationName: string | null;
    designationLevel: number;
    roles: string[];
    isHead: boolean;
  };

  const empsByDept: Record<string, EmpView[]> = {};
  const unassigned: EmpView[] = [];
  for (const e of employees) {
    const view: EmpView = {
      id: e.id,
      empCode: e.empCode,
      name: e.name,
      designationName: e.designationRef?.name ?? null,
      designationLevel: e.designationRef?.level ?? 0,
      roles: e.roleMemberships.map((r) => r.role.name),
      isHead: false,
    };
    if (e.departments.length === 0) {
      unassigned.push(view);
      continue;
    }
    // Show under every department, but mark whether they're the primary
    // there for visual emphasis.
    for (const dep of e.departments) {
      empsByDept[dep.departmentId] ??= [];
      empsByDept[dep.departmentId].push({ ...view, isHead: false });
    }
  }
  // Mark dept heads
  for (const d of departments) {
    if (!d.headEmployeeId) continue;
    const list = empsByDept[d.id];
    if (!list) continue;
    const head = list.find((e) => e.id === d.headEmployeeId);
    if (head) head.isHead = true;
  }

  // Sort each dept's employees by designation level desc, name asc.
  for (const arr of Object.values(empsByDept)) {
    arr.sort(
      (a, b) =>
        b.designationLevel - a.designationLevel ||
        a.name.localeCompare(b.name),
    );
  }

  // Group employees within each department by designation tier for the
  // visual layout.
  function tierGroups(emps: EmpView[]) {
    const tiers: { level: number; designation: string; emps: EmpView[] }[] = [];
    for (const e of emps) {
      const last = tiers[tiers.length - 1];
      if (last && last.level === e.designationLevel && last.designation === (e.designationName ?? "Unassigned")) {
        last.emps.push(e);
      } else {
        tiers.push({
          level: e.designationLevel,
          designation: e.designationName ?? "Unassigned",
          emps: [e],
        });
      }
    }
    return tiers;
  }

  return (
    <>
      <TopBar
        title="Organisational Hierarchy"
        subtitle={`${departments.length} departments · ${employees.length} employees · auto-built from Designations + Departments`}
      />
      <div className="p-margin space-y-lg">
        {departments.length === 0 && (
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">
              No departments configured yet. Add them in{" "}
              <Link href="/hr/masters/departments" className="text-blue-700 underline">
                Masters → Departments
              </Link>
              .
            </p>
          </Section>
        )}

        {departments.map((d) => {
          const emps = empsByDept[d.id] ?? [];
          const tiers = tierGroups(emps);
          return (
            <Section
              key={d.id}
              title={d.name}
              action={
                <span className="text-caption text-on-surface-variant">
                  {emps.length} member{emps.length === 1 ? "" : "s"}
                </span>
              }
            >
              {d.description && (
                <p className="text-on-surface-variant text-label-sm mb-md">{d.description}</p>
              )}
              {d.headEmployee && (
                <div className="text-label-sm mb-md">
                  <span className="text-on-surface-variant">Head: </span>
                  <Link
                    href={`/hr/employees/${d.headEmployee.id}`}
                    className="font-bold text-on-surface hover:underline"
                  >
                    {d.headEmployee.empCode} · {d.headEmployee.name}
                  </Link>
                </div>
              )}
              {tiers.length === 0 ? (
                <p className="text-on-surface-variant text-label-sm">No employees yet.</p>
              ) : (
                <div className="space-y-md">
                  {tiers.map((tier, ti) => (
                    <div key={ti}>
                      <div className="text-caption text-on-surface-variant uppercase tracking-wider mb-xs">
                        {tier.designation}
                        {tier.level > 0 && (
                          <span className="ml-xs text-[10px]">L{tier.level}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-sm">
                        {tier.emps.map((emp) => (
                          <Link
                            key={emp.id}
                            href={`/hr/employees/${emp.id}`}
                            className={
                              "rounded-lg border px-md py-sm hover:shadow-md transition flex flex-col gap-xs min-w-[200px] " +
                              (emp.isHead
                                ? "border-primary bg-primary/5"
                                : "border-outline-variant bg-surface")
                            }
                          >
                            <div className="font-bold text-label-sm">
                              {emp.isHead && (
                                <span className="text-primary mr-xs" title="Department head">
                                  ★
                                </span>
                              )}
                              {emp.name}
                            </div>
                            <div className="text-caption text-on-surface-variant">
                              {emp.empCode}
                            </div>
                            {emp.roles.length > 0 && (
                              <div className="text-caption text-on-surface-variant">
                                {emp.roles.join(" · ")}
                              </div>
                            )}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          );
        })}

        {unassigned.length > 0 && (
          <Section
            title="Unassigned (no department)"
            action={
              <span className="text-caption text-on-surface-variant">
                {unassigned.length} employee{unassigned.length === 1 ? "" : "s"}
              </span>
            }
          >
            <div className="flex flex-wrap gap-sm">
              {unassigned.map((emp) => (
                <Link
                  key={emp.id}
                  href={`/hr/employees/${emp.id}`}
                  className="rounded-lg border border-yellow-300 bg-yellow-50 px-md py-sm hover:shadow-md transition flex flex-col gap-xs min-w-[200px]"
                >
                  <div className="font-bold text-label-sm">{emp.name}</div>
                  <div className="text-caption text-on-surface-variant">{emp.empCode}</div>
                </Link>
              ))}
            </div>
          </Section>
        )}

        <Section title="Designation tiers (company-wide)">
          {designations.length === 0 ? (
            <p className="text-on-surface-variant text-label-sm">No designations configured.</p>
          ) : (
            <table className="w-full text-label-sm">
              <thead className="text-left text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="py-sm pr-md">Designation</th>
                  <th className="py-sm pr-md text-right">Level</th>
                  <th className="py-sm pr-md text-right">Employees</th>
                </tr>
              </thead>
              <tbody>
                {designations.map((d) => {
                  const count = employees.filter((e) => e.designationId === d.id).length;
                  return (
                    <tr key={d.id} className="border-b border-outline-variant last:border-0">
                      <td className="py-sm pr-md font-semibold">{d.name}</td>
                      <td className="py-sm pr-md text-right">{d.level}</td>
                      <td className="py-sm pr-md text-right">{count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </>
  );
}
