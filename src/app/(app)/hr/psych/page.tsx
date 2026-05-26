import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";

export const dynamic = "force-dynamic";

export default async function PsychDashboardPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Psychometric Assessments" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">No access.</p>
          </Section>
        </div>
      </>
    );
  }

  const [test, totals, recent] = await Promise.all([
    prisma.psychTest.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }),
    prisma.psychAssignment.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.psychAssignment.findMany({
      where: { status: "COMPLETED" },
      orderBy: { submittedAt: "desc" },
      take: 8,
      include: {
        employee: { select: { id: true, name: true, empCode: true } },
        report: { select: { profileLabel: true, attitudeIndex: true, attitudeClass: true } },
      },
    }),
  ]);

  const tot = Object.fromEntries(totals.map((t) => [t.status, t._count._all])) as Record<string, number>;
  const assigned = tot.ASSIGNED ?? 0;
  const inProgress = tot.IN_PROGRESS ?? 0;
  const completed = tot.COMPLETED ?? 0;
  const expired = tot.EXPIRED ?? 0;

  return (
    <>
      <TopBar
        title="Psychometric Assessments"
        subtitle={
          test
            ? `Active cycle: ${test.name}`
            : "No active cycle — seed one via prisma/seed-psych.ts"
        }
        action={
          <div className="flex gap-sm">
            <Link href="/hr/psych/assignments" className="px-md py-sm rounded bg-primary text-on-primary font-bold">
              Assignments
            </Link>
            <Link href="/hr/psych/questions" className="px-md py-sm rounded border border-outline-variant">
              Questions
            </Link>
          </div>
        }
      />
      <div className="p-margin space-y-lg">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-sm">
          <KpiCard label="Pending" value={assigned} hint="Awaiting employee start" tone="primary" />
          <KpiCard label="In progress" value={inProgress} />
          <KpiCard label="Completed" value={completed} tone="success" />
          <KpiCard label="Expired" value={expired} tone="danger" />
        </div>

        <Section title="Recent completions">
          {recent.length === 0 ? (
            <p className="text-on-surface-variant text-label-sm py-lg text-center">No completed assessments yet.</p>
          ) : (
            <table className="w-full text-label-sm">
              <thead className="text-left text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="py-sm pr-md">Employee</th>
                  <th className="py-sm pr-md">Profile</th>
                  <th className="py-sm pr-md text-right">Attitude</th>
                  <th className="py-sm pr-md">Class</th>
                  <th className="py-sm pr-md">Submitted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recent.map((a) => (
                  <tr key={a.id} className="border-b border-outline-variant last:border-0">
                    <td className="py-sm pr-md font-semibold">
                      {a.employee.empCode} · {a.employee.name}
                    </td>
                    <td className="py-sm pr-md">{a.report?.profileLabel ?? "—"}</td>
                    <td className="py-sm pr-md text-right">{a.report?.attitudeIndex ?? "—"}</td>
                    <td className="py-sm pr-md">{a.report?.attitudeClass ?? "—"}</td>
                    <td className="py-sm pr-md">
                      {a.submittedAt ? a.submittedAt.toISOString().slice(0, 16).replace("T", " ") : "—"}
                    </td>
                    <td className="py-sm pr-md text-right">
                      <Link
                        href={`/hr/psych/reports/${a.employee.id}`}
                        className="text-blue-700 underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </>
  );
}
