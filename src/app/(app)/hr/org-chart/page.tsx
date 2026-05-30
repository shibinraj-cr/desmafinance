import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import styles from "./org-chart.module.css";

export const dynamic = "force-dynamic";

type Variant = "root" | "head" | "ic" | "dept-only" | "placeholder";

function Box({
  variant,
  empId,
  title,
  sub,
  code,
  star,
}: {
  variant: Variant;
  empId?: string;
  title: string;
  sub?: string | null;
  code?: string | null;
  star?: boolean;
}) {
  const map: Record<Variant, string> = {
    root: "bg-blue-900 text-white border-blue-800",
    head: "bg-blue-700 text-white border-blue-600",
    ic: "bg-blue-600 text-white border-blue-500",
    "dept-only": "bg-blue-100 text-blue-900 border-blue-300",
    placeholder: "bg-surface-container text-on-surface-variant border-outline-variant",
  };
  const widths: Record<Variant, string> = {
    root: "min-w-[220px]",
    head: "min-w-[200px]",
    ic: "min-w-[190px]",
    "dept-only": "min-w-[200px]",
    placeholder: "min-w-[220px]",
  };
  const card = (
    <div
      className={
        "rounded-md border-2 px-md py-sm text-center shadow-sm " +
        widths[variant] +
        " " +
        map[variant] +
        (empId ? " hover:shadow-md transition cursor-pointer" : "")
      }
    >
      <div className="font-bold text-label-sm leading-tight">
        {star && <span className="mr-xs">★</span>}
        {title}
      </div>
      {sub && (
        <div className="text-caption leading-tight opacity-90 mt-[2px]">{sub}</div>
      )}
      {code && (
        <div className="text-[10px] opacity-70 mt-[2px]">#{code}</div>
      )}
    </div>
  );
  if (empId) return <Link href={`/hr/employees/${empId}`}>{card}</Link>;
  return card;
}

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
        headEmployee: {
          select: {
            id: true,
            empCode: true,
            name: true,
            designationRef: { select: { name: true, level: true } },
          },
        },
      },
    }),
    prisma.employee.findMany({
      where: { active: true },
      include: {
        designationRef: true,
        departments: { include: { department: true } },
      },
    }),
    prisma.hrDesignation.findMany({ orderBy: { level: "desc" } }),
  ]);

  // Root = highest-level employee. Ties broken by name.
  const sortedByLevel = [...employees].sort((a, b) => {
    const la = a.designationRef?.level ?? 0;
    const lb = b.designationRef?.level ?? 0;
    if (lb !== la) return lb - la;
    return a.name.localeCompare(b.name);
  });
  const root = sortedByLevel[0] ?? null;

  // Hide any department headed by the MD themselves (e.g. a "Management" dept) —
  // it would draw a redundant "Reports directly to MD" box, and the MD is the root.
  const chartDepartments = root
    ? departments.filter((d) => d.headEmployeeId !== root.id)
    : departments;

  const headIds = new Set(
    departments
      .map((d) => d.headEmployeeId)
      .filter((id): id is string => Boolean(id)),
  );

  // ICs grouped under each department's primary id, excluding root + heads.
  const icsByDept: Record<string, typeof employees> = {};
  for (const e of employees) {
    if (e.id === root?.id) continue;
    if (headIds.has(e.id)) continue;
    const primary = e.departments.find((d) => d.isPrimary) ?? e.departments[0];
    if (!primary) continue;
    icsByDept[primary.departmentId] ??= [];
    icsByDept[primary.departmentId].push(e);
  }
  for (const arr of Object.values(icsByDept)) {
    arr.sort((a, b) => {
      const la = a.designationRef?.level ?? 0;
      const lb = b.designationRef?.level ?? 0;
      if (lb !== la) return lb - la;
      return a.name.localeCompare(b.name);
    });
  }

  const unassigned = employees.filter(
    (e) => e.id !== root?.id && !headIds.has(e.id) && e.departments.length === 0,
  );

  return (
    <>
      <TopBar
        title="Organisational Hierarchy"
        subtitle={`${departments.length} departments · ${employees.length} active employees · auto-built from Designations + Departments`}
      />
      <div className="p-margin space-y-lg">
        <Section title="">
          {departments.length === 0 && !root ? (
            <p className="py-lg text-center text-on-surface-variant">
              No employees or departments configured yet.{" "}
              <Link href="/hr/masters/departments" className="text-blue-700 underline">
                Add departments
              </Link>{" "}
              and assign heads to see the chart.
            </p>
          ) : (
            <div className={styles.wrap}>
              <ul className={styles.tree}>
                <li>
                  {root ? (
                    <Box
                      variant="root"
                      empId={root.id}
                      title={root.name}
                      sub={root.designationRef?.name ?? "—"}
                      code={root.empCode}
                    />
                  ) : (
                    <Box
                      variant="placeholder"
                      title="DESMA Finance"
                      sub="No MD / CEO assigned"
                    />
                  )}
                  {chartDepartments.length > 0 && (
                    <ul>
                      {chartDepartments.map((d) => {
                        const isHeadRoot = d.headEmployeeId === root?.id;
                        const head = isHeadRoot ? null : d.headEmployee ?? null;
                        const ics = icsByDept[d.id] ?? [];
                        return (
                          <li key={d.id}>
                            {head ? (
                              <Box
                                variant="head"
                                empId={head.id}
                                title={head.name}
                                sub={`${d.name} — ${head.designationRef?.name ?? "Head"}`}
                                code={head.empCode}
                                star
                              />
                            ) : (
                              <Box
                                variant="dept-only"
                                title={d.name}
                                sub={
                                  isHeadRoot
                                    ? "Reports directly to MD"
                                    : "No head assigned"
                                }
                              />
                            )}
                            {ics.length > 0 && (
                              <div className={styles.icList}>
                                {ics.map((e) => (
                                  <div key={e.id} className={styles.icItem}>
                                    <Box
                                      variant="ic"
                                      empId={e.id}
                                      title={e.name}
                                      sub={e.designationRef?.name ?? ""}
                                      code={e.empCode}
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              </ul>
            </div>
          )}
        </Section>

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
              {unassigned.map((e) => (
                <Link
                  key={e.id}
                  href={`/hr/employees/${e.id}`}
                  className="rounded-lg border border-yellow-300 bg-yellow-50 px-md py-sm hover:shadow-md transition flex flex-col gap-xs min-w-[200px]"
                >
                  <div className="font-bold text-label-sm">{e.name}</div>
                  <div className="text-caption text-on-surface-variant">
                    {e.empCode}
                  </div>
                </Link>
              ))}
            </div>
          </Section>
        )}

        <Section title="Designation tiers (company-wide)">
          {designations.length === 0 ? (
            <p className="text-on-surface-variant text-label-sm">
              No designations configured.
            </p>
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
