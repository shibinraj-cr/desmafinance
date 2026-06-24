import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import {
  buildCrmTaskWhere,
  crmTaskListInclude,
  crmTaskListOrderBy,
  serializeCrmTaskListRow,
} from "@/lib/crm-leads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // xlsx + Buffer

const MAX_ROWS = 50000; // safety cap

// GET /api/crm/tasks/export — download the *filtered* tasks as an .xlsx.
// Accepts the same query params as the task board, so the export always matches
// what the user is currently looking at. Defaults to OPEN (pending) tasks, the
// actionable view, exactly like the board page.
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const sp = new URL(req.url).searchParams;
  const statusParam = sp.get("status") || undefined;
  // Mirror the board: no status → open; status=all → every status.
  const status = statusParam === "all" ? undefined : statusParam ?? "open";

  const where = buildCrmTaskWhere({
    status,
    assignee: sp.get("assignee") || undefined,
    priority: sp.get("priority") || undefined,
    due: sp.get("due") || undefined,
    kind: sp.get("kind") || undefined,
    q: sp.get("q") || undefined,
    now: new Date(),
  });

  const rows = await prisma.crmTask.findMany({
    where,
    orderBy: crmTaskListOrderBy(sp.get("sort") || undefined),
    take: MAX_ROWS,
    include: crmTaskListInclude,
  });

  const data = rows.map((r) => {
    const t = serializeCrmTaskListRow(r);
    return {
      Consultant: t.assignedToName ?? "Unassigned",
      Name: t.lead.candidateName,
      Number: t.lead.phone ?? t.lead.phoneE164 ?? "",
      Stage: t.lead.status.label,
      Task: t.subject,
      Priority: t.priority,
      "Due date": t.dueAt ? new Date(t.dueAt).toLocaleDateString("en-IN") : "",
      Status: t.status,
    };
  });

  const ws = XLSX.utils.json_to_sheet(data, {
    header: ["Consultant", "Name", "Number", "Stage", "Task", "Priority", "Due date", "Status"],
  });
  // Reasonable column widths.
  ws["!cols"] = [
    { wch: 20 }, { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 36 }, { wch: 10 }, { wch: 14 }, { wch: 10 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tasks");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buf);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="tasks-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
