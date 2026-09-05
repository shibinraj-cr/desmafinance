"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type MyTaskRow = {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  completedByName: string | null;
  /** Null on a standalone task — one filed under no candidate project. */
  projectId: string | null;
  candidateName: string | null;
  serviceName: string | null;
  stepSeq: number | null;
  stepName: string | null;
};

export type ProjectOption = { id: string; candidateName: string; serviceName: string };
export type UserLite = { id: string; username: string };
type StepOption = { id: string; seq: number; name: string };

const LABELS: Record<string, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  no_due: "No due date",
  done: "Recently done",
};

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const secondaryBtn =
  "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
    </label>
  );
}

export function MyTasksClient({
  groups,
  projects,
  opsUsers,
  currentUserId,
}: {
  groups: { key: string; rows: MyTaskRow[] }[];
  projects: ProjectOption[];
  opsUsers: UserLite[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  async function toggle(r: MyTaskRow) {
    const done = r.status === "done";
    setBusyId(r.id);
    setError(null);
    const res = await fetch(`/api/operations/action-items/${r.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: done ? "reopen" : "complete" }),
    });
    setBusyId(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message || d.error || "Action failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-lg">
      <div className="flex items-center justify-between gap-md">
        <p className="text-label-sm text-on-surface-variant">
          Tasks you schedule for yourself, plus anything raised on your candidate projects.
        </p>
        {!composing && (
          <button onClick={() => setComposing(true)} className={primaryBtn}>
            New task
          </button>
        )}
      </div>

      {composing && (
        <NewTaskForm
          projects={projects}
          opsUsers={opsUsers}
          currentUserId={currentUserId}
          onCancel={() => setComposing(false)}
          onCreated={(msg) => {
            setComposing(false);
            setNotice(msg);
            router.refresh();
          }}
        />
      )}

      {error && <div className="text-label-sm text-error">{error}</div>}
      {notice && <div className="text-label-sm text-primary">{notice}</div>}

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center text-on-surface-variant">
          No tasks assigned to you.
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key}>
            <h2
              className={
                "text-label-sm uppercase tracking-wider mb-sm " +
                (g.key === "overdue" ? "text-error" : "text-on-surface-variant")
              }
            >
              {LABELS[g.key] ?? g.key} · {g.rows.length}
            </h2>
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant/60">
              {g.rows.map((r) => {
                const done = r.status === "done" || r.status === "cancelled";
                return (
                  <div key={r.id} className="px-md py-sm flex items-start gap-sm">
                    <button
                      disabled={r.status === "cancelled" || busyId === r.id}
                      onClick={() => toggle(r)}
                      title={r.status === "done" ? "Reopen" : "Mark done"}
                      className="mt-[1px] shrink-0 disabled:opacity-40"
                    >
                      <span
                        className={
                          "material-symbols-outlined text-[20px] leading-none " +
                          (r.status === "done" ? "text-primary" : "text-on-surface-variant")
                        }
                      >
                        {r.status === "done" ? "check_box" : "check_box_outline_blank"}
                      </span>
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className={"text-body-sm " + (done ? "line-through text-on-surface-variant" : "text-on-surface")}>
                        {r.title}
                      </div>
                      <div className="text-label-sm text-on-surface-variant">
                        {r.projectId ? (
                          <>
                            <Link href={`/operations/projects/${r.projectId}`} className="text-primary hover:underline">
                              {r.candidateName}
                            </Link>
                            {" · "}
                            {r.serviceName}
                            {r.stepName && (
                              <>
                                {" "}
                                · step {r.stepSeq}: {r.stepName}
                              </>
                            )}
                          </>
                        ) : (
                          <span className="italic">Personal task</span>
                        )}
                        {r.dueAt && <> · due {fmtDate(r.dueAt)}</>}
                        {r.status === "cancelled" && <> · cancelled</>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/**
 * Compose a task and schedule it. The candidate project is optional — leaving
 * it blank files a standalone personal to-do — and the step picker only appears
 * once a project is chosen, its options fetched on demand from that project.
 */
function NewTaskForm({
  projects,
  opsUsers,
  currentUserId,
  onCancel,
  onCreated,
}: {
  projects: ProjectOption[];
  opsUsers: UserLite[];
  currentUserId: string;
  onCancel: () => void;
  onCreated: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [stepId, setStepId] = useState("");
  // Default to me: the folder shows my queue, so a task I raise lands where I
  // will see it unless I deliberately hand it to someone else.
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const [dueAt, setDueAt] = useState("");
  const [steps, setSteps] = useState<StepOption[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One in-flight step fetch at a time; a stale response must not overwrite the
  // steps of the project the user has since switched to.
  const stepReq = useRef(0);

  const loadSteps = useCallback(async (id: string) => {
    const req = ++stepReq.current;
    setSteps([]);
    setStepId("");
    if (!id) return;
    setStepsLoading(true);
    const res = await fetch(`/api/operations/projects/${id}`);
    const data = (await res.json().catch(() => ({}))) as {
      project?: { tasks?: { id: string; seq: number; name: string }[] };
    };
    if (req !== stepReq.current) return;
    setStepsLoading(false);
    if (res.ok) setSteps((data.project?.tasks ?? []).map((t) => ({ id: t.id, seq: t.seq, name: t.name })));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/operations/action-items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: t,
        description: description.trim() || null,
        projectId: projectId || null,
        taskId: stepId || null,
        assignedToId: assigneeId || null,
        dueAt: dueAt || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message || d.error || "Could not create the task.");
      return;
    }
    const assignee = opsUsers.find((u) => u.id === assigneeId);
    onCreated(
      assigneeId && assigneeId !== currentUserId && assignee
        ? `Task created and assigned to ${assignee.username} — it now sits in their queue.`
        : "Task created.",
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
      <Field label="Task *">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Chase the AHPRA document request"
          maxLength={300}
          className={inputCls}
        />
      </Field>

      <div className="grid gap-md sm:grid-cols-2">
        <Field label="Candidate project">
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              void loadSteps(e.target.value);
            }}
            className={inputCls}
          >
            <option value="">No project — personal task</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.candidateName} · {p.serviceName}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Step">
          <select
            value={stepId}
            onChange={(e) => setStepId(e.target.value)}
            disabled={!projectId || stepsLoading}
            className={inputCls + " disabled:opacity-50"}
          >
            <option value="">
              {!projectId ? "Pick a project first" : stepsLoading ? "Loading steps…" : "No specific step"}
            </option>
            {steps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.seq}. {s.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Assign to">
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputCls}>
            <option value="">Unassigned</option>
            {opsUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id === currentUserId ? `${u.username} (me)` : u.username}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Due date">
          <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={inputCls} />
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Optional detail"
          className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md"
        />
      </Field>

      {error && <div className="text-label-sm text-error">{error}</div>}

      <div className="flex items-center gap-sm">
        <button type="submit" disabled={saving || !title.trim()} className={primaryBtn}>
          {saving ? "Adding…" : "Add task"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryBtn}>
          Cancel
        </button>
      </div>
    </form>
  );
}
