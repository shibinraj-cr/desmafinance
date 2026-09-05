import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, OPS_USER_ANCHORS } from "@/lib/ops-rbac";
import {
  opsMyTaskInclude,
  serializeMyTaskRow,
  bucketMyTask,
  myTasksWhere,
  type MyTaskBucket,
} from "@/lib/ops-action-items";
import { istDateString } from "@/lib/lead-pulse-dates";
import { MyTasksClient } from "./client";

export const dynamic = "force-dynamic";

// Folder order: actionable first, done last.
const ORDER: MyTaskBucket[] = ["overdue", "today", "upcoming", "no_due", "done"];

export default async function OperationsMyTasksPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = getOpsAccess(userId, perms);
  if (!access.isOpsUser) {
    return (
      <>
        <TopBar title="My Tasks" subtitle="Operations" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The Operations workspace is available to the operations team only.
          </div>
        </div>
      </>
    );
  }

  const [items, projects, opsUsers] = await Promise.all([
    prisma.opsActionItem.findMany({
      where: myTasksWhere(userId),
      include: opsMyTaskInclude,
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    }),
    // The projects a new task may be filed under: exactly the ones
    // `canEditProject` lets this user touch, so the picker can never offer a
    // project the create call would reject. Closed projects are left out — you
    // do not schedule fresh work on a finished candidate.
    prisma.opsProject.findMany({
      where: {
        status: { in: ["active", "on_hold"] },
        ...(access.isOpsManager ? {} : { assignedToId: userId }),
      },
      select: { id: true, party: { select: { name: true } }, service: { select: { name: true } } },
      orderBy: [{ party: { name: "asc" } }],
      take: 500,
    }),
    prisma.user.findMany({
      where: { roleRef: { pages: { hasSome: OPS_USER_ANCHORS } } },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    }),
  ]);

  const rows = items.map(serializeMyTaskRow);
  const today = istDateString();
  // Cap the "done" section so the folder stays about open work.
  const groups = ORDER.map((key) => ({
    key,
    rows: rows.filter((r) => bucketMyTask(r, today) === key),
  }))
    .map((g) => (g.key === "done" ? { ...g, rows: g.rows.slice(-20).reverse() } : g))
    .filter((g) => g.rows.length > 0);

  const openCount = rows.filter((r) => r.status === "open").length;

  return (
    <>
      <TopBar title="My Tasks" subtitle={`${openCount} open task${openCount === 1 ? "" : "s"} assigned to you`} />
      <div className="p-margin">
        <MyTasksClient
          groups={groups}
          projects={projects.map((p) => ({ id: p.id, candidateName: p.party.name, serviceName: p.service.name }))}
          opsUsers={opsUsers}
          currentUserId={userId}
        />
      </div>
    </>
  );
}
