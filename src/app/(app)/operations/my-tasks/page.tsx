import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess } from "@/lib/ops-rbac";
import { opsMyTaskInclude, serializeMyTaskRow, bucketMyTask, type MyTaskBucket } from "@/lib/ops-action-items";
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

  const rows = (
    await prisma.opsActionItem.findMany({
      where: { assignedToId: userId },
      include: opsMyTaskInclude,
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    })
  ).map(serializeMyTaskRow);

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
        <MyTasksClient groups={groups} />
      </div>
    </>
  );
}
