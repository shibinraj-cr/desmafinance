"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ProjectRow = {
  id: string;
  candidateName: string;
  serviceName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  status: string;
  templateName: string | null;
  templateVersion: number | null;
  startedAt: string;
  dueAt: string | null;
  lastActivityAt: string;
  taskTotal: number;
  taskDone: number;
  taskOpen: number;
  overdueCount: number;
};
type ServiceLite = { id: string; name: string };
type UserLite = { id: string; username: string };

const STATUS_TONE: Record<string, string> = {
  active: "bg-primary/15 text-primary",
  on_hold: "bg-surface-container-high text-on-surface-variant",
  completed: "bg-accent/20 text-accent",
  cancelled: "bg-error-container text-on-error-container",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={"inline-block px-xs py-[1px] rounded text-label-sm capitalize " + (STATUS_TONE[status] ?? "bg-surface-container-high")}>
      {status.replace("_", " ")}
    </span>
  );
}

const selCls = "h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-sm outline-none focus:border-primary";

export function ProjectsClient({
  projects,
  services,
  opsUsers,
  canAssign,
  currentUserId,
}: {
  projects: ProjectRow[];
  services: ServiceLite[];
  opsUsers: UserLite[];
  canAssign: boolean;
  currentUserId: string;
}) {
  const [status, setStatus] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [assignee, setAssignee] = useState("");

  const filtered = useMemo(
    () =>
      projects.filter((p) => {
        if (status && p.status !== status) return false;
        if (serviceId && p.serviceName !== services.find((s) => s.id === serviceId)?.name) return false;
        if (assignee === "me" && p.assigneeId !== currentUserId) return false;
        if (assignee === "unassigned" && p.assigneeId) return false;
        if (assignee && assignee !== "me" && assignee !== "unassigned" && p.assigneeId !== assignee) return false;
        return true;
      }),
    [projects, status, serviceId, assignee, services, currentUserId],
  );

  const unassignedCount = projects.filter((p) => !p.assigneeId).length;

  return (
    <div className="space-y-md">
      <div className="flex flex-wrap items-center gap-sm">
        <select className={selCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="on_hold">On hold</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className={selCls} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">All services</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select className={selCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned{unassignedCount ? ` (${unassignedCount})` : ""}</option>
          {opsUsers.map((u) => (
            <option key={u.id} value={u.id}>{u.username}</option>
          ))}
        </select>
        <span className="text-label-sm text-on-surface-variant ml-auto">{filtered.length} of {projects.length}</span>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-auto">
        <table className="w-full text-body-md">
          <thead className="bg-surface-container-low text-on-surface-variant">
            <tr>
              <th className="px-md py-sm text-left text-label-sm uppercase tracking-wider">Candidate</th>
              <th className="px-md py-sm text-left text-label-sm uppercase tracking-wider">Service</th>
              <th className="px-md py-sm text-left text-label-sm uppercase tracking-wider">Status</th>
              <th className="px-md py-sm text-left text-label-sm uppercase tracking-wider">Progress</th>
              <th className="px-md py-sm text-left text-label-sm uppercase tracking-wider">Owner</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-md py-xl text-center text-on-surface-variant">No projects match these filters.</td></tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="border-t border-outline-variant/60 hover:bg-surface-container-low/50">
                  <td className="px-md py-sm">
                    <Link href={`/operations/projects/${p.id}`} className="font-medium text-primary hover:underline">
                      {p.candidateName}
                    </Link>
                  </td>
                  <td className="px-md py-sm text-on-surface-variant">{p.serviceName}</td>
                  <td className="px-md py-sm"><StatusPill status={p.status} /></td>
                  <td className="px-md py-sm">
                    <span className="tabular-nums">{p.taskDone}/{p.taskTotal}</span>
                    {p.overdueCount > 0 && (
                      <span className="ml-xs px-xs rounded text-label-sm bg-error-container text-on-error-container">{p.overdueCount} overdue</span>
                    )}
                  </td>
                  <td className="px-md py-sm">
                    {canAssign ? (
                      <AssigneeSelect projectId={p.id} value={p.assigneeId} users={opsUsers} />
                    ) : (
                      <span className="text-on-surface-variant">{p.assigneeName ?? "—"}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AssigneeSelect({ projectId, value, users }: { projectId: string; value: string | null; users: UserLite[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(v: string) {
    setBusy(true);
    const res = await fetch(`/api/operations/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignedToId: v || null }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <select
      className={selCls + " max-w-[180px]"}
      disabled={busy}
      value={value ?? ""}
      onChange={(e) => change(e.target.value)}
    >
      <option value="">Unassigned</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>{u.username}</option>
      ))}
    </select>
  );
}
