"use client";

import { useMemo, useState } from "react";
import { MultiSelect } from "@/components/MultiSelect";
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
  const [status, setStatus] = useState<string[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [assignee, setAssignee] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const serviceNames = serviceIds
      .map((id) => services.find((s) => s.id === id)?.name)
      .filter((n): n is string => !!n);
    // "Me" and "Unassigned" are people-shaped sentinels, so a selection unions
    // them with any explicitly picked owners.
    const ownerIds = assignee.map((a) => (a === "me" ? currentUserId : a)).filter((a) => a !== "unassigned");
    const wantsUnassigned = assignee.includes("unassigned");
    return projects.filter((p) => {
      if (status.length && !status.includes(p.status)) return false;
      if (serviceNames.length && !serviceNames.includes(p.serviceName)) return false;
      if (assignee.length) {
        const matches =
          (wantsUnassigned && !p.assigneeId) || (!!p.assigneeId && ownerIds.includes(p.assigneeId));
        if (!matches) return false;
      }
      return true;
    });
  }, [projects, status, serviceIds, assignee, services, currentUserId]);

  const unassignedCount = projects.filter((p) => !p.assigneeId).length;

  return (
    <div className="space-y-md">
      <div className="flex flex-wrap items-center gap-sm">
        <MultiSelect
          placeholder="All statuses"
          options={[
            { value: "active", label: "Active" },
            { value: "on_hold", label: "On hold" },
            { value: "completed", label: "Completed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          selected={status}
          onChange={setStatus}
        />
        <MultiSelect
          placeholder="All services"
          options={services.map((s) => ({ value: s.id, label: s.name }))}
          selected={serviceIds}
          onChange={setServiceIds}
        />
        <MultiSelect
          placeholder="Anyone"
          options={[
            { value: "me", label: "Assigned to me" },
            { value: "unassigned", label: "Unassigned", hint: unassignedCount ? String(unassignedCount) : undefined },
            ...opsUsers.map((u) => ({ value: u.id, label: u.username })),
          ]}
          selected={assignee}
          onChange={setAssignee}
        />
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
