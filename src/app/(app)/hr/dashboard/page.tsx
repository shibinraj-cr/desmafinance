import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { monthKeyFromDate } from "@/lib/hr-data";

export const dynamic = "force-dynamic";

export default async function HrDashboardPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="HR" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              You don&apos;t have access to the HR module.
            </div>
          </Section>
        </div>
      </>
    );
  }

  const now = new Date();
  const monthKey = monthKeyFromDate(now);

  const [employees, activeEmployees, pendingLeaves, currentRun, openPolicies] = await Promise.all([
    prisma.employee.count(),
    prisma.employee.count({ where: { active: true } }),
    prisma.hrLeaveRequest.count({ where: { status: "pending" } }),
    prisma.hrSalaryRun.findUnique({ where: { monthKey } }),
    prisma.hrPolicy.count({ where: { status: "published" } }),
  ]);

  const tiles: { label: string; value: string | number; href: string; icon: string }[] = [
    { label: "Active Employees", value: activeEmployees, href: "/hr/employees", icon: "groups" },
    { label: "Total on Master", value: employees, href: "/hr/employees", icon: "person" },
    { label: "Pending Leaves", value: pendingLeaves, href: "/hr/leave", icon: "event_busy" },
    {
      label: `Salary Run ${monthKey}`,
      value: currentRun ? currentRun.status.replace("_", " ") : "Not started",
      href: "/hr/salary",
      icon: "payments",
    },
    { label: "Published Policies", value: openPolicies, href: "/hr/policies", icon: "menu_book" },
  ];

  return (
    <>
      <TopBar title="HR Dashboard" subtitle={`This month · ${monthKey}`} />
      <div className="p-margin space-y-lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-base">
          {tiles.map((t) => (
            <Link
              key={t.label}
              href={t.href}
              className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg shadow-sm hover:shadow-md transition flex flex-col gap-sm"
            >
              <div className="flex items-center gap-sm text-on-surface-variant">
                <span className="material-symbols-outlined">{t.icon}</span>
                <span className="text-label-sm uppercase tracking-wider">{t.label}</span>
              </div>
              <span className="text-h2 font-extrabold text-on-surface">{t.value}</span>
            </Link>
          ))}
        </div>

        <Section title="Quick links">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-sm">
            {[
              { href: "/hr/attendance", icon: "fact_check", label: "Upload attendance" },
              { href: "/hr/salary", icon: "calculate", label: "Run salary" },
              { href: "/hr/leave", icon: "rule", label: "Review leaves" },
              { href: "/hr/policies", icon: "menu_book", label: "Publish policy" },
              { href: "/hr/trainings", icon: "school", label: "Create training" },
              { href: "/hr/holidays", icon: "event", label: "Holiday calendar" },
              { href: "/hr/shifts", icon: "schedule", label: "Shifts" },
              { href: "/hr/employees", icon: "groups", label: "Employees" },
            ].map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="flex items-center gap-sm px-md py-sm rounded-lg border border-outline-variant hover:bg-surface-container transition text-on-surface"
              >
                <span className="material-symbols-outlined">{q.icon}</span>
                <span className="text-label-sm">{q.label}</span>
              </Link>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
