import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess } from "@/lib/ops-rbac";
import { opsProjectListInclude, serializeProjectRow, type OpsProjectRow } from "@/lib/ops-queries";

export const dynamic = "force-dynamic";

const GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: "active", label: "Active", statuses: ["active"] },
  { key: "on_hold", label: "On hold", statuses: ["on_hold"] },
  { key: "completed", label: "Completed", statuses: ["completed", "cancelled"] },
];

export default async function OperationsMyWorkPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = getOpsAccess(userId, perms);
  if (!access.isOpsUser) {
    return (
      <>
        <TopBar title="My Work" subtitle="Operations" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The Operations workspace is available to the operations team only.
          </div>
        </div>
      </>
    );
  }

  const rows = await prisma.opsProject.findMany({
    where: { assignedToId: userId },
    include: opsProjectListInclude,
    orderBy: [{ dueAt: "asc" }, { lastActivityAt: "desc" }],
  });
  const projects = rows.map((p) => serializeProjectRow(p));
  const totalOverdue = projects.reduce((n, p) => n + p.overdueCount, 0);

  return (
    <>
      <TopBar title="My Work" subtitle={`${projects.length} project${projects.length === 1 ? "" : "s"} assigned to you`} />
      <div className="p-margin space-y-lg">
        {totalOverdue > 0 && (
          <div className="rounded-xl border border-error/40 bg-error-container/40 text-on-error-container px-md py-sm text-body-sm">
            {totalOverdue} task{totalOverdue === 1 ? "" : "s"} overdue across your projects.
          </div>
        )}
        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center text-on-surface-variant">
            Nothing assigned to you yet.
          </div>
        ) : (
          GROUPS.map((g) => {
            const items = projects.filter((p) => g.statuses.includes(p.status));
            if (items.length === 0) return null;
            return (
              <section key={g.key}>
                <h2 className="text-label-sm uppercase tracking-wider text-on-surface-variant mb-sm">
                  {g.label} · {items.length}
                </h2>
                <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((p) => (
                    <ProjectCard key={p.id} p={p} />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

function ProjectCard({ p }: { p: OpsProjectRow }) {
  const pct = p.taskTotal ? Math.round((p.taskDone / p.taskTotal) * 100) : 0;
  return (
    <Link
      href={`/operations/projects/${p.id}`}
      className="block rounded-xl border border-outline-variant bg-surface-container-lowest p-md shadow-sm hover:border-primary/50 transition border-l-4 border-l-primary"
    >
      <div className="font-semibold text-on-surface truncate">{p.candidateName}</div>
      <div className="text-label-sm text-on-surface-variant truncate">{p.serviceName}</div>
      <div className="mt-sm h-1.5 rounded-full bg-surface-container-high overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-xs flex items-center justify-between text-label-sm text-on-surface-variant">
        <span className="tabular-nums">{p.taskDone}/{p.taskTotal} done</span>
        {p.overdueCount > 0 ? (
          <span className="px-xs rounded bg-error-container text-on-error-container">{p.overdueCount} overdue</span>
        ) : (
          <span className="tabular-nums">{p.taskOpen} open</span>
        )}
      </div>
    </Link>
  );
}
