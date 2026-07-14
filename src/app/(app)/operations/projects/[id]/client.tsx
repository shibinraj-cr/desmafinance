"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ActionItemDTO = {
  id: string;
  taskId: string | null;
  title: string;
  description: string | null;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  completedByName: string | null;
  completedAt: string | null;
  createdAt: string;
};
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
  actionItems: ActionItemDTO[];
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

  // Create / update / delete an ad-hoc task on a step. `busyKey` scopes the
  // spinner (a step's add-form uses "new:<stepId>"; a row uses the item id).
  async function mutateActionItem(
    busyKey: string,
    req: { url: string; method: string; body?: Record<string, unknown> },
  ): Promise<boolean> {
    setBusyId(busyKey);
    setError(null);
    const res = await fetch(req.url, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body: req.body ? JSON.stringify(req.body) : undefined,
    });
    setBusyId(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message || d.error || "Task action failed.");
      return false;
    }
    router.refresh();
    return true;
  }

  // Reassign the project owner, offering to carry the outgoing owner's still-open
  // tasks to the new owner — the mid-process hand-off in one action. Completed
  // steps keep their own completedBy attribution regardless.
  async function changeOwner(newOwnerId: string | null) {
    const body: Record<string, unknown> = { assignedToId: newOwnerId };
    const oldOwnerId = project.assigneeId;
    if (newOwnerId && oldOwnerId && newOwnerId !== oldOwnerId) {
      const openForOld = project.tasks
        .flatMap((t) => t.actionItems)
        .filter((a) => a.status === "open" && a.assigneeId === oldOwnerId).length;
      if (openForOld > 0) {
        const newName = opsUsers.find((u) => u.id === newOwnerId)?.username ?? "the new owner";
        body.carryOpenTasks = window.confirm(
          `Move ${openForOld} open task${openForOld === 1 ? "" : "s"} from the current owner to ${newName}?`,
        );
      }
    }
    await patchProject(body);
  }

  const pct = project.taskTotal ? Math.round((project.taskDone / project.taskTotal) * 100) : 0;
  const phases = groupByPhase(project.tasks);
  const phaseStatsList = phaseStats(project.tasks);

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
                  onChange={(e) => changeOwner(e.target.value || null)}
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

      {/* Phase progress — the main stages of the process */}
      {phaseStatsList.length >= 2 && <PhaseProgress stats={phaseStatsList} />}

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
                      <StepTasks
                        step={t}
                        canEdit={canEdit}
                        opsUsers={opsUsers}
                        busyId={busyId}
                        onMutate={mutateActionItem}
                      />
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

type MutateFn = (
  busyKey: string,
  req: { url: string; method: string; body?: Record<string, unknown> },
) => Promise<boolean>;

/** Ad-hoc tasks attached to one step: the list + an inline "+ Task" form. */
function StepTasks({
  step,
  canEdit,
  opsUsers,
  busyId,
  onMutate,
}: {
  step: TaskDTO;
  canEdit: boolean;
  opsUsers: UserLite[];
  busyId: string | null;
  onMutate: MutateFn;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");

  const items = step.actionItems;
  const openCount = items.filter((i) => i.status === "open").length;
  const newKey = `new:${step.id}`;
  const inCls = "h-8 px-sm rounded-md border border-outline-variant bg-surface-container-lowest text-body-sm outline-none focus:border-primary";

  async function submit() {
    const t = title.trim();
    if (!t) return;
    const ok = await onMutate(newKey, {
      url: "/api/operations/action-items",
      method: "POST",
      body: { taskId: step.id, title: t, assignedToId: assigneeId || null, dueAt: dueAt || null },
    });
    if (ok) {
      setTitle("");
      setAssigneeId("");
      setDueAt("");
      setAdding(false);
    }
  }

  if (items.length === 0 && !canEdit) return null;

  return (
    <div className="mt-sm pl-md border-l-2 border-outline-variant/50 space-y-xs">
      {items.length > 0 && (
        <div className="text-label-sm uppercase tracking-wider text-on-surface-variant">
          Tasks{openCount > 0 ? ` · ${openCount} open` : ""}
        </div>
      )}
      {items.map((i) => (
        <ActionItemRow key={i.id} item={i} canEdit={canEdit} busyId={busyId} onMutate={onMutate} />
      ))}
      {canEdit &&
        (adding ? (
          <div className="flex flex-wrap items-center gap-xs pt-xs">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title…"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") setAdding(false);
              }}
              className={inCls + " flex-1 min-w-[160px]"}
            />
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inCls + " text-label-sm"}>
              <option value="">Unassigned</option>
              {opsUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </select>
            <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={inCls + " text-label-sm"} />
            <button disabled={busyId === newKey || !title.trim()} onClick={submit} className={actionBtn}>Add</button>
            <button onClick={() => setAdding(false)} className={actionBtn}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="text-label-sm text-primary hover:underline">+ Task</button>
        ))}
    </div>
  );
}

/** A single ad-hoc task row: a done toggle, its meta, and a delete affordance. */
function ActionItemRow({
  item,
  canEdit,
  busyId,
  onMutate,
}: {
  item: ActionItemDTO;
  canEdit: boolean;
  busyId: string | null;
  onMutate: MutateFn;
}) {
  const done = item.status === "done";
  const cancelled = item.status === "cancelled";
  const overdue = !done && !cancelled && !!item.dueAt && item.dueAt.slice(0, 10) < todayKey();
  const url = `/api/operations/action-items/${item.id}`;

  return (
    <div className="flex items-start gap-xs group">
      <button
        disabled={!canEdit || cancelled || busyId === item.id}
        onClick={() => onMutate(item.id, { url, method: "PATCH", body: { action: done ? "reopen" : "complete" } })}
        title={done ? "Reopen" : "Mark done"}
        className="mt-[1px] shrink-0 disabled:opacity-40"
      >
        <span className={"material-symbols-outlined text-[18px] leading-none " + (done ? "text-primary" : "text-on-surface-variant")}>
          {done ? "check_box" : "check_box_outline_blank"}
        </span>
      </button>
      <div className="flex-1 min-w-0">
        <span className={"text-body-sm " + (done || cancelled ? "line-through text-on-surface-variant" : "text-on-surface")}>
          {item.title}
        </span>
        <span className="text-label-sm text-on-surface-variant">
          {item.assigneeName && <> · {item.assigneeName}</>}
          {item.dueAt && <> · due {fmtDate(item.dueAt)}</>}
          {done && item.completedByName && <> · done by {item.completedByName}</>}
          {cancelled && <> · cancelled</>}
        </span>
        {overdue && <span className="ml-xs px-xs rounded text-label-sm bg-error-container text-on-error-container">overdue</span>}
      </div>
      {canEdit && (
        <button
          onClick={() => {
            if (window.confirm(`Delete task "${item.title}"?`)) onMutate(item.id, { url, method: "DELETE" });
          }}
          disabled={busyId === item.id}
          title="Delete task"
          className="opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-error shrink-0 disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-[16px] leading-none">delete</span>
        </button>
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

type PhaseStat = { phase: string; total: number; done: number; status: "done" | "active" | "pending" };

/**
 * Roll the steps up into their named phases (the "main stages" of the process),
 * in template order. A phase is `done` when all its steps are done/skipped,
 * `active` once any step is started or done, else `pending`.
 */
function phaseStats(tasks: TaskDTO[]): PhaseStat[] {
  return groupByPhase(tasks)
    .filter((g) => g.phase != null)
    .map((g) => {
      const total = g.tasks.length;
      const done = g.tasks.filter((t) => t.status === "completed" || t.status === "skipped").length;
      const anyActive = g.tasks.some((t) => t.status === "in_progress" || t.status === "blocked");
      const status: PhaseStat["status"] = done === total ? "done" : done > 0 || anyActive ? "active" : "pending";
      return { phase: g.phase as string, total, done, status };
    });
}

/** Horizontal stepper across the process's main phases. Scrolls on overflow. */
function PhaseProgress({ stats }: { stats: PhaseStat[] }) {
  const currentIndex = stats.findIndex((s) => s.status !== "done");
  const allDone = currentIndex === -1;
  const current = allDone ? stats.length - 1 : currentIndex;

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm p-lg">
      <div className="flex items-center justify-between gap-md mb-md">
        <h3 className="text-body-sm font-semibold text-on-surface">Process stages</h3>
        <span className="text-label-sm text-on-surface-variant text-right">
          {allDone ? "All stages complete" : `Stage ${current + 1} of ${stats.length} · ${stats[current].phase}`}
        </span>
      </div>
      <div className="flex items-start overflow-x-auto scrollbar-thin pb-xs">
        {stats.map((s, i) => {
          const prevDone = i > 0 && stats[i - 1].status === "done";
          const isCurrent = i === current && !allDone;
          const circle =
            s.status === "done"
              ? "bg-primary text-on-primary"
              : isCurrent
                ? "bg-primary/15 text-primary border-2 border-primary"
                : "bg-surface-container-high text-on-surface-variant";
          return (
            <div key={s.phase} className="flex flex-col items-center flex-1 min-w-[92px]">
              <div className="flex items-center w-full">
                <div className={"h-0.5 flex-1 " + (i === 0 ? "opacity-0" : prevDone ? "bg-primary" : "bg-outline-variant")} />
                <div className={"grid place-items-center w-8 h-8 rounded-full text-label-sm font-semibold shrink-0 " + circle}>
                  {s.status === "done" ? <span className="material-symbols-outlined text-[18px] leading-none">check</span> : i + 1}
                </div>
                <div className={"h-0.5 flex-1 " + (i === stats.length - 1 ? "opacity-0" : s.status === "done" ? "bg-primary" : "bg-outline-variant")} />
              </div>
              <span className={"mt-xs text-label-sm text-center px-xs leading-tight " + (isCurrent ? "text-primary font-semibold" : "text-on-surface")}>
                {s.phase}
              </span>
              <span className="text-caption text-on-surface-variant tabular-nums">{s.done}/{s.total}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
