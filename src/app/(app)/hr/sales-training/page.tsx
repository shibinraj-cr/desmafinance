import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { Bar, NoAccess, Pill } from "@/components/sales-training/ui";
import { loadProgress, summarise, type ModuleProgress } from "@/lib/sales-training-db";

export const dynamic = "force-dynamic";

function Cell({ p, maxAttempts }: { p: ModuleProgress; maxAttempts: number | null }) {
  if (p.passed) return <Pill tone="green">{p.bestPercent}%</Pill>;
  if (p.status === "failed") return <Pill tone="red">{p.bestPercent}% · out</Pill>;
  if (p.attempts > 0) {
    return (
      <Pill tone="amber">
        {p.bestPercent}% · {p.attempts}
        {maxAttempts ? `/${maxAttempts}` : ""} tries
      </Pill>
    );
  }
  if (p.videosDone > 0 || p.status === "in_progress") {
    return <Pill tone="blue">▶ {p.videosDone}/{p.videosTotal}</Pill>;
  }
  return <span className="text-on-surface-variant">—</span>;
}

export default async function SalesTrainingOverviewPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) return <NoAccess title="Sales Training" />;

  const [modules, learners, draftCount] = await Promise.all([
    prisma.salesTrainingModule.findMany({
      where: { status: "published" },
      orderBy: { sortOrder: "asc" },
      select: { id: true, title: true, videos: true, maxAttempts: true, passMark: true },
    }),
    prisma.salesTrainingLearner.findMany({
      where: { active: true },
      include: { employee: { select: { id: true, name: true, empCode: true, designationRef: { select: { name: true } }, designation: true } } },
      orderBy: { employee: { name: "asc" } },
    }),
    prisma.salesTrainingModule.count({ where: { status: "draft" } }),
  ]);
  const progress = await loadProgress(modules, learners.map((l) => l.employeeId));
  const now = new Date();

  const rows = learners
    .map((l) => {
      const per = progress.get(l.employeeId)!;
      const s = summarise(modules.map((m) => per.get(m.id)!));
      const overdue = !!l.dueDate && l.dueDate < now && s.passed < s.total;
      return { l, per, s, overdue };
    })
    .sort((a, b) => b.s.completionPct - a.s.completionPct || (b.s.avgScore ?? -1) - (a.s.avgScore ?? -1));

  const cells = rows.length * modules.length;
  const passedCells = rows.reduce((n, r) => n + r.s.passed, 0);
  const scored = rows.filter((r) => r.s.avgScore != null);
  const avgScore = scored.length ? Math.round(scored.reduce((n, r) => n + (r.s.avgScore ?? 0), 0) / scored.length) : null;
  const overdue = rows.filter((r) => r.overdue).length;

  // Per-module pass rate across active learners — where the curriculum is hard.
  const moduleStats = modules.map((m) => {
    const ps = rows.map((r) => r.per.get(m.id)!);
    const attempted = ps.filter((p) => p.attempts > 0);
    return {
      m,
      passed: ps.filter((p) => p.passed).length,
      attempted: attempted.length,
      avg: attempted.length ? Math.round(attempted.reduce((n, p) => n + (p.bestPercent ?? 0), 0) / attempted.length) : null,
    };
  });

  return (
    <>
      <TopBar title="Sales Training" subtitle="Sales Consultant Training & Development" />
      <div className="p-margin space-y-lg">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-md">
          <KpiCard label="Active learners" value={learners.length} hint="enrolled consultants" />
          <KpiCard label="Live modules" value={modules.length} hint={draftCount ? `${draftCount} in draft` : "none in draft"} />
          <KpiCard
            label="Completion"
            value={cells ? `${Math.round((passedCells * 100) / cells)}%` : "—"}
            hint={`${passedCells} of ${cells} module passes`}
            tone="primary"
          />
          <KpiCard
            label="Avg best score"
            value={avgScore != null ? `${avgScore}%` : "—"}
            hint={overdue ? `${overdue} learner(s) overdue` : "nobody overdue"}
            tone={overdue ? "danger" : "default"}
          />
        </div>

        {modules.length === 0 || learners.length === 0 ? (
          <Section title="Getting started">
            <ol className="list-decimal pl-lg space-y-sm text-body-md text-on-surface">
              <li className={modules.length ? "text-on-surface-variant line-through" : ""}>
                <Link href="/hr/sales-training/modules" className="text-blue-700 underline">Create a module</Link>, paste
                its unlisted YouTube links, add the questions, then publish it.
              </li>
              <li className={learners.length ? "text-on-surface-variant line-through" : ""}>
                <Link href="/hr/sales-training/learners" className="text-blue-700 underline">Enrol your sales consultants</Link>{" "}
                — they&apos;re notified and find it under My Workspace → Sales Training.
              </li>
              <li>Scores land here as they watch and take each quiz.</li>
            </ol>
          </Section>
        ) : (
          <Section
            title="Scoreboard"
            action={<span className="text-label-sm text-on-surface-variant">best score per module · ranked by completion</span>}
          >
            <div className="overflow-x-auto -mx-lg px-lg">
              <table className="w-full text-label-sm">
                <thead className="text-left text-on-surface-variant border-b border-outline-variant">
                  <tr>
                    <th className="py-sm pr-md">#</th>
                    <th className="py-sm pr-md min-w-[180px]">Consultant</th>
                    <th className="py-sm pr-md min-w-[120px]">Progress</th>
                    <th className="py-sm pr-md">Avg</th>
                    {modules.map((m, i) => (
                      <th key={m.id} className="py-sm pr-md whitespace-nowrap" title={m.title}>
                        M{i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ l, per, s, overdue: late }, i) => (
                    <tr key={l.id} className="border-b border-outline-variant last:border-0">
                      <td className="py-sm pr-md text-on-surface-variant">{i + 1}</td>
                      <td className="py-sm pr-md">
                        <Link href={`/hr/sales-training/learners/${l.employeeId}`} className="font-semibold text-on-surface hover:underline">
                          {l.employee.name}
                        </Link>
                        <div className="text-[11px] text-on-surface-variant">
                          {l.employee.empCode} · {l.employee.designationRef?.name ?? l.employee.designation ?? "—"}
                          {late && <span className="text-red-700 font-bold"> · overdue</span>}
                        </div>
                      </td>
                      <td className="py-sm pr-md">
                        <div className="flex items-center gap-xs">
                          <Bar pct={s.completionPct} tone={s.completionPct === 100 ? "green" : "primary"} />
                          <span className="whitespace-nowrap text-on-surface-variant">
                            {s.passed}/{s.total}
                          </span>
                        </div>
                      </td>
                      <td className="py-sm pr-md font-semibold">{s.avgScore != null ? `${s.avgScore}%` : "—"}</td>
                      {modules.map((m) => (
                        <td key={m.id} className="py-sm pr-md">
                          <Cell p={per.get(m.id)!} maxAttempts={m.maxAttempts} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {modules.length > 0 && (
          <Section title="Modules">
            <div className="overflow-x-auto">
              <table className="w-full text-label-sm">
                <thead className="text-left text-on-surface-variant border-b border-outline-variant">
                  <tr>
                    <th className="py-sm pr-md">#</th>
                    <th className="py-sm pr-md">Module</th>
                    <th className="py-sm pr-md">Pass mark</th>
                    <th className="py-sm pr-md">Passed</th>
                    <th className="py-sm pr-md">Attempted</th>
                    <th className="py-sm pr-md">Avg best</th>
                  </tr>
                </thead>
                <tbody>
                  {moduleStats.map(({ m, passed, attempted, avg }, i) => (
                    <tr key={m.id} className="border-b border-outline-variant last:border-0">
                      <td className="py-sm pr-md text-on-surface-variant">M{i + 1}</td>
                      <td className="py-sm pr-md">
                        <Link href={`/hr/sales-training/modules/${m.id}`} className="font-semibold hover:underline">
                          {m.title}
                        </Link>
                      </td>
                      <td className="py-sm pr-md">{m.passMark}%</td>
                      <td className="py-sm pr-md">
                        {passed}/{learners.length}
                      </td>
                      <td className="py-sm pr-md">{attempted}</td>
                      <td className="py-sm pr-md">{avg != null ? `${avg}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
