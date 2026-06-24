import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import {
  buildCrmTaskWhere,
  crmTaskListInclude,
  crmTaskListOrderBy,
  serializeCrmTaskListRow,
  getAssignableBdes,
  REINQUIRY_TASK_SUBJECT_NEEDLE,
} from "@/lib/crm-leads";
import { TasksBoard } from "./client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SP = { [k: string]: string | string[] | undefined };

function str(sp: SP, k: string): string | undefined {
  const v = sp[k];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) {
    return (
      <>
        <TopBar title="Tasks" subtitle="CRM" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            You don&apos;t have access to the CRM. Ask an administrator to grant you the CRM pages.
          </div>
        </div>
      </>
    );
  }

  const now = new Date();
  // Default the board to OPEN tasks — the actionable view. Pass status=all to widen.
  const statusParam = str(searchParams, "status");
  const status = statusParam === "all" ? undefined : statusParam ?? "open";

  const filters = {
    status,
    assignee: str(searchParams, "assignee"),
    priority: str(searchParams, "priority"),
    due: str(searchParams, "due"),
    kind: str(searchParams, "kind"),
    q: str(searchParams, "q"),
    now,
  };
  const where = buildCrmTaskWhere(filters);
  const sort = str(searchParams, "sort");
  const requestedPage = Math.max(1, parseInt(str(searchParams, "page") || "1", 10) || 1);

  const total = await prisma.crmTask.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  const [rows, bdes, openCount, overdueCount, dueTodayCount, unassignedOpenCount, reinquiryCount] = await Promise.all([
    prisma.crmTask.findMany({
      where,
      orderBy: crmTaskListOrderBy(sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: crmTaskListInclude,
    }),
    getAssignableBdes(),
    prisma.crmTask.count({ where: { status: "open" } }),
    prisma.crmTask.count({ where: { status: "open", dueAt: { lt: today } } }),
    prisma.crmTask.count({ where: { status: "open", dueAt: { gte: today, lt: tomorrow } } }),
    prisma.crmTask.count({ where: { status: "open", assignedToId: null } }),
    prisma.crmTask.count({ where: { status: "open", subject: { contains: REINQUIRY_TASK_SUBJECT_NEEDLE, mode: "insensitive" } } }),
  ]);

  const counts = {
    open: openCount,
    overdue: overdueCount,
    dueToday: dueTodayCount,
    unassignedOpen: unassignedOpenCount,
    reinquiry: reinquiryCount,
  };
  const accessProps = { isAdmin: access.isAdmin, isBde: access.isBde, userId };

  return (
    <>
      <TopBar title="Tasks" subtitle={`${total} task${total === 1 ? "" : "s"}`} />
      <div className="p-margin space-y-lg">
        <TasksBoard
          tasks={rows.map(serializeCrmTaskListRow)}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          bdes={bdes}
          counts={counts}
          access={accessProps}
        />
      </div>
    </>
  );
}
