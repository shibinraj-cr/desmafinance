"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type TaskDTO = {
  id: string;
  seq: number;
  name: string;
  description: string | null;
  phase: string | null;
  isRequired: boolean;
  status: string;
  slaDays: number | null;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  assigneeName: string | null;
  completedByName: string | null;
  blockedReason: string | null;
  notes: string | null;
};
type ActivityDTO = { id: string; type: string; summary: string | null; actorName: string | null; occurredAt: string };
type ProjectDetail = {
  id: string;
  candidateName: string;
  serviceName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  status: string;
  templateName: string | null;
  templateVersion: number | null;
  dueAt: string | null;
  taskTotal: number;
  taskDone: number;
  leadId: string | null;
  candidateEmail: string | null;
  candidatePhone: string | null;
  tasks: TaskDTO[];
  activities: ActivityDTO[];
};
type UserLite = { id: string; username: string };

const TASK_TONE: Record<string, string> = {
  pending: "bg-surface-container-high text-on-surface-variant",
  in_progress: "bg-primary/15 text-primary",
  completed: "bg-accent/20 text-accent",
  blocked: "bg-error-container text-on-error-container",
  skipped: "bg-surface-container-high text-on-surface-variant line-through",
};
const selCls = "h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-sm outline-none focus:border-primary";
const actionBtn = "px-sm h-7 rounded-md border border-outline-variant text-label-sm hover:bg-surface-container-low transition disabled:opacity-50";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function isOverdue(t: TaskDTO): boolean {
  if (!t.dueAt || t.status === "completed" || t.status === "skipped") return false;
  return t.dueAt.slice(0, 10) < todayKey();
}

const ACTIONS: Record<string, { action: string; label: string }[]> = {
  pending: [
    { action: "start", label: "Start" },
    { action: "complete", label: "Complete" },
    { action: "skip", label: "Skip" },
    { action: "block", label: "Block" },
  ],
  in_progress: [
    { action: "complete", label: "Complete" },
    { action: "block", label: "Block" },
    { action: "skip", label: "Skip" },
  ],
  blocked: [
    { action: "start", label: "Resume" },
    { action: "complete", label: "Complete" },
    { action: "skip", label: "Skip" },
  ],
  completed: [{ action: "reopen", label: "Reopen" }],
  skipped: [{ action: "reopen", label: "Reopen" }],
};

export function ProjectDetailClient({
  project,
  canEdit,
  canAssign,
  opsUsers,
}: {
  project: ProjectDetail;
  canEdit: boolean;
  canAssign: boolean;
  opsUsers: UserLite[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"checklist" | "history">("checklist");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function taskAction(taskId: string, action: string) {
    let blockedReason: string | null = null;
    if (action === "block") {
      blockedReason = window.prompt("Why is this step blocked?")?.trim() || null;
      if (!blockedReason) return;
    }
    setBusyId(taskId);
    setError(null);
    const res = await fetch(`/api/operations/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, blockedReason }),
    });
    setBusyId(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message || d.error || "Action failed.");
      return;
    }
    router.refresh();
  }

  async function patchProject(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/operations/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message || d.error || "Update failed.");
      return;
    }
    router.refresh();
  }

  const pct = project.taskTotal ? Math.round((project.taskDone / project.taskTotal) * 100) : 0;
  const phases = groupByPhase(project.tasks);

  return (
    <div className="space-y-lg">
      {/* Header */}
      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm p-lg border-l-4 border-l-primary">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div>
            <div className="flex items-center gap-sm flex-wrap">
              <span className={"px-xs py-[1px] rounded text-label-sm capitalize " + (TASK_TONE[project.status] ?? "bg-surface-container-high")}>
                {project.status.replace("_", " ")}
              </span>
              {project.templateName && (
                <span className="text-label-sm text-on-surface-variant">
                  {project.templateName} v{project.templateVersion}
                </span>
              )}
            </div>
            <div className="mt-xs text-body-sm text-on-surface-variant">
              {project.candidateEmail || "—"} · {project.candidatePhone || "—"}
              {project.leadId && (
                <>
                  {" · "}
                  <a className="text-primary hover:underline" href={`/crm/leads/${project.leadId}`}>CRM lead</a>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-sm">
            {canAssign && (
              <label className="text-label-sm text-on-surface-variant">
                Owner{" "}
                <select
                  className={selCls}
                  value={project.assigneeId ?? ""}
                  onChange={(e) => patchProject({ assignedToId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {opsUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.username}</option>
                  ))}
                </select>
              </label>
            )}
            {canEdit && (
              <label className="text-label-sm text-on-surface-variant">
                Status{" "}
                <select className={selCls} value={project.status} onChange={(e) => patchProject({ status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            )}
          </div>
        </div>
        <div className="mt-md">
          <div className="flex items-center justify-between text-label-sm text-on-surface-variant mb-xs">
            <span>{project.taskDone}/{project.taskTotal} steps done · due {fmtDate(project.dueAt)}</span>
            {!canAssign && <span>Owner: {project.assigneeName ?? "Unassigned"}</span>}
          </div>
          <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {error && <div className="mt-sm text-label-sm text-error">{error}</div>}
      </section>

      {/* Tabs */}
      <div className="flex gap-xs border-b border-outline-variant">
        {(["checklist", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "px-md py-sm text-body-sm capitalize border-b-2 -mb-[1px] " +
              (tab === t ? "border-primary text-primary font-semibold" : "border-transparent text-on-surface-variant")
            }
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "checklist" ? (
        <div className="space-y-lg">
          {phases.map(({ phase, tasks }) => (
            <div key={phase ?? "_"}>
              {phase && <h3 className="text-label-sm uppercase tracking-wider text-on-surface-variant mb-sm">{phase}</h3>}
              <div className="space-y-xs">
                {tasks.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm flex items-start gap-md"
                  >
                    <span className="text-on-surface-variant tabular-nums w-6 pt-[2px]">{t.seq}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-sm flex-wrap">
                        <span className="font-medium text-on-surface">{t.name}</span>
                        {!t.isRequired && <span className="text-label-sm text-on-surface-variant">(optional)</span>}
                        <span className={"px-xs py-[1px] rounded text-label-sm capitalize " + (TASK_TONE[t.status] ?? "")}>
                          {t.status.replace("_", " ")}
                        </span>
                        {isOverdue(t) && <span className="px-xs rounded text-label-sm bg-error-container text-on-error-container">overdue</span>}
                      </div>
                      {t.description && <div className="text-label-sm text-on-surface-variant mt-[2px]">{t.description}</div>}
                      <div className="text-label-sm text-on-surface-variant mt-[2px]">
                        {t.dueAt && <>due {fmtDate(t.dueAt)} · </>}
                        {t.completedAt ? (
                          <>done {fmtDate(t.completedAt)}{t.completedByName && <> by {t.completedByName}</>}</>
                        ) : t.slaDays != null ? (
                          <>{t.slaDays}d SLA</>
                        ) : null}
                        {t.blockedReason && <span className="text-error"> · blocked: {t.blockedReason}</span>}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap gap-xs justify-end pt-[2px]">
                        {(ACTIONS[t.status] ?? []).map((a) => (
                          <button key={a.action} className={actionBtn} disabled={busyId === t.id} onClick={() => taskAction(t.id, a.action)}>
                            {a.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant/60">
          {project.activities.length === 0 ? (
            <div className="p-lg text-center text-on-surface-variant">No activity yet.</div>
          ) : (
            project.activities.map((a) => (
              <div key={a.id} className="px-md py-sm flex items-start gap-md">
                <span className="text-label-sm text-on-surface-variant whitespace-nowrap w-[150px]">
                  {new Date(a.occurredAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </span>
                <div className="flex-1">
                  <span className="text-body-sm text-on-surface">{a.summary ?? a.type}</span>
                  {a.actorName && <span className="text-label-sm text-on-surface-variant"> · {a.actorName}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function groupByPhase(tasks: TaskDTO[]): { phase: string | null; tasks: TaskDTO[] }[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, TaskDTO[]>();
  for (const t of tasks) {
    const key = t.phase ?? null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(t);
  }
  return order.map((phase) => ({ phase, tasks: map.get(phase)! }));
}
