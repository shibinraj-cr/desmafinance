"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { CrmTaskListRow } from "@/lib/crm-leads";
import { DEFAULT_STATUS_COLOR } from "@/lib/crm";
import { NextStepDialog, type NextStepPayload } from "@/components/crm/NextStepDialog";
import { TaskEditDialog, type TaskEditPayload } from "@/components/crm/TaskEditDialog";

export type BdeOpt = { userId: string; displayName: string; username: string; role: string };
export type TasksAccess = { isAdmin: boolean; isBde: boolean; userId: string };
export type TaskCounts = { open: number; overdue: number; dueToday: number; unassignedOpen: number; reinquiry: number };

// ── Reusable class strings (verbatim from the leads board design system) ────
const selectClass =
  "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition";

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={"px-md py-sm text-label-sm uppercase tracking-wider " + className}>{children}</th>;
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={"px-md py-sm align-middle " + className}>{children}</td>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}
function startOfToday(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-red-500/15 text-red-700 border-red-500/40",
  normal: "bg-surface-container-high text-on-surface-variant border-outline-variant",
  low: "bg-surface-container-high text-on-surface-variant/70 border-outline-variant",
};
function PriorityPill({ priority }: { priority: string }) {
  return (
    <span
      className={
        "px-xs py-[2px] rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap border " +
        (PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.normal)
      }
    >
      {priority}
    </span>
  );
}

function LeadStatusPill({ status }: { status: { label: string; color: string | null } }) {
  const color = status.color || DEFAULT_STATUS_COLOR;
  return (
    <span
      className="px-xs py-[2px] rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
      style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}66` }}
    >
      {status.label}
    </span>
  );
}

// A task is a re-inquiry follow-up when its subject carries "re-inquiry" — the
// shared marker across every creator (action, oversight, rescue "Re-engage").
// Mirrors the server-side `kind=reinquiry` filter (REINQUIRY_TASK_SUBJECT_NEEDLE).
function isReInquiryTask(subject: string): boolean {
  return /re-inquiry/i.test(subject);
}
function ReInquiryBadge() {
  return (
    <span
      className="inline-flex items-center gap-[2px] shrink-0 px-xs py-[2px] rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap border bg-accent/15 text-accent border-accent/40"
      title="Re-inquiry — an existing candidate submitted again"
    >
      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>autorenew</span>
      Re-inquiry
    </span>
  );
}

const SORT_OPTIONS = [
  { value: "due_asc", label: "Due soonest" },
  { value: "due_desc", label: "Due latest" },
  { value: "created_desc", label: "Newest" },
  { value: "created_asc", label: "Oldest" },
];

export function TasksBoard({
  tasks,
  total,
  page,
  pageSize,
  bdes,
  counts,
  access,
}: {
  tasks: CrmTaskListRow[];
  total: number;
  page: number;
  pageSize: number;
  bdes: BdeOpt[];
  counts: TaskCounts;
  access: TasksAccess;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [q, setQ] = useState(search.get("q") ?? "");

  useEffect(() => {
    setQ(search.get("q") ?? "");
  }, [search]);

  function update(patch: Record<string, string | null>, keepPage = false) {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    if (!keepPage && !("page" in patch)) params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Export link mirrors the current filters (drop pagination — export all matches).
  const exportParams = new URLSearchParams(search.toString());
  exportParams.delete("page");
  const exportHref = "/api/crm/tasks/export" + (exportParams.toString() ? `?${exportParams.toString()}` : "");
  const today = startOfToday();
  const statusVal = search.get("status") ?? "open";
  const dueVal = search.get("due") ?? "";
  // Effective assignee mirrors the server default: a BDE with no explicit
  // assignee lands on their own queue ("my tasks"); non-BDEs (and the explicit
  // "All tasks" / "all" choice) see everyone. Used for the select value + chips.
  const rawAssignee = search.get("assignee");
  const assigneeVal = rawAssignee ?? (access.isBde ? access.userId : "all");
  const kindVal = search.get("kind") ?? "";
  const anyFilter =
    !!search.get("status") ||
    !!search.get("assignee") ||
    !!search.get("priority") ||
    !!search.get("due") ||
    !!search.get("kind") ||
    !!search.get("q");

  // Quick-filter chips. `active` highlights the chip when its filter is set.
  // Each chip is a one-click preset: it sets the dimension(s) it owns and clears
  // the others (status/assignee/priority/due/kind) so the chips stay exclusive.
  // "No narrowing" = the plain open list with no due/kind/priority facet, used so
  // the All/My scope chips light up only when nothing else is filtering.
  const noNarrowing = statusVal === "open" && !dueVal && !kindVal && !search.get("priority");
  const chips: { key: string; label: string; count?: number; active: boolean; patch: Record<string, string | null> }[] = [
    { key: "open", label: "All open", count: counts.open, active: assigneeVal === "all" && noNarrowing, patch: { status: null, assignee: "all", priority: null, due: null, kind: null, q: null } },
    { key: "overdue", label: "Overdue", count: counts.overdue, active: dueVal === "overdue", patch: { due: "overdue", status: null, assignee: null, priority: null, kind: null } },
    { key: "today", label: "Due today", count: counts.dueToday, active: dueVal === "today", patch: { due: "today", status: null, assignee: null, priority: null, kind: null } },
    { key: "reinquiry", label: "Re-inquiry", count: counts.reinquiry, active: kindVal === "reinquiry", patch: { kind: "reinquiry", status: null, assignee: null, priority: null, due: null } },
    { key: "unassigned", label: "Unassigned", count: counts.unassignedOpen, active: assigneeVal === "unassigned", patch: { assignee: "unassigned", status: null, due: null, priority: null, kind: null } },
  ];
  if (access.isBde) {
    chips.push({ key: "mine", label: "My tasks", active: assigneeVal === access.userId && noNarrowing, patch: { assignee: access.userId, status: null, due: null, kind: null, priority: null } });
  }

  // When completing the last open task on a still-active lead, the API rejects
  // with 422 next_task_required; we then collect the next follow-up and retry.
  const [pendingComplete, setPendingComplete] = useState<CrmTaskListRow | null>(null);
  const [nextBusy, setNextBusy] = useState(false);
  const [nextError, setNextError] = useState<string | null>(null);

  async function setStatus(task: CrmTaskListRow, status: "done" | "open") {
    const res = await fetch(`/api/crm/leads/${task.leadId}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (status === "done" && res.status === 422) {
      const j = await res.json().catch(() => null);
      if (j?.error === "next_task_required") {
        setNextError(null);
        setPendingComplete(task);
        return;
      }
    }
    if (res.ok) router.refresh();
  }

  async function submitNextStep(payload: NextStepPayload) {
    if (!pendingComplete) return;
    setNextBusy(true);
    setNextError(null);
    const res = await fetch(`/api/crm/leads/${pendingComplete.leadId}/tasks/${pendingComplete.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done", nextTask: payload }),
    });
    setNextBusy(false);
    if (res.ok) {
      setPendingComplete(null);
      router.refresh();
    } else {
      setNextError("Couldn’t complete the task. Please try again.");
    }
  }

  // Edit an existing task's subject/due/priority/assignee/note in place (PATCH),
  // shared between this board and the single-lead Tasks tab via TaskEditDialog.
  const [editingTask, setEditingTask] = useState<CrmTaskListRow | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function saveEdit(payload: TaskEditPayload) {
    if (!editingTask) return;
    setEditBusy(true);
    setEditError(null);
    const res = await fetch(`/api/crm/leads/${editingTask.leadId}/tasks/${editingTask.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setEditBusy(false);
    if (res.ok) {
      setEditingTask(null);
      router.refresh();
    } else {
      setEditError("Couldn’t save changes. Please try again.");
    }
  }

  return (
    <div className="space-y-md">
      {pendingComplete && (
        <NextStepDialog
          leadName={pendingComplete.lead.candidateName}
          busy={nextBusy}
          error={nextError}
          onCancel={() => {
            setPendingComplete(null);
            setNextError(null);
          }}
          onSubmit={submitNextStep}
        />
      )}
      {editingTask && (
        <TaskEditDialog
          task={{
            subject: editingTask.subject,
            dueAt: editingTask.dueAt,
            priority: editingTask.priority,
            assignedToId: editingTask.assignedToId,
            note: editingTask.note,
          }}
          bdes={bdes}
          busy={editBusy}
          error={editError}
          onCancel={() => {
            setEditingTask(null);
            setEditError(null);
          }}
          onSubmit={saveEdit}
        />
      )}
      {/* Quick-filter chips */}
      <div className="flex flex-wrap items-center gap-xs">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => update(c.patch)}
            className={
              "inline-flex items-center gap-xs h-8 px-md rounded-full border text-label-sm font-semibold transition " +
              (c.active
                ? "bg-primary text-on-primary border-primary"
                : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
            }
          >
            {c.label}
            {typeof c.count === "number" && (
              <span
                className={
                  "text-[10px] font-bold px-xs py-[1px] rounded-full min-w-[18px] text-center " +
                  (c.active ? "bg-on-primary/20" : "bg-surface-container-high")
                }
              >
                {c.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filter band */}
      <div className="flex flex-wrap items-center gap-base">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q.trim() || null });
          }}
          className="flex items-center"
        >
          <div className="relative">
            <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: 18 }}>
              search
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search task or lead…"
              className="h-9 pl-9 pr-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition w-60"
            />
          </div>
        </form>

        <select className={selectClass} value={statusVal} onChange={(e) => update({ status: e.target.value })}>
          <option value="open">Open</option>
          <option value="done">Done</option>
          <option value="all">All statuses</option>
        </select>

        <select className={selectClass} value={assigneeVal} onChange={(e) => update({ assignee: e.target.value })}>
          <option value="all">All consultants</option>
          <option value="unassigned">Unassigned</option>
          {bdes.map((b) => (
            <option key={b.userId} value={b.userId}>
              {b.displayName}
            </option>
          ))}
        </select>

        <select className={selectClass} value={search.get("priority") ?? ""} onChange={(e) => update({ priority: e.target.value || null })}>
          <option value="">All priorities</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>

        <select className={selectClass} value={dueVal} onChange={(e) => update({ due: e.target.value || null })}>
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Due this week</option>
          <option value="no_date">No due date</option>
        </select>

        <select className={selectClass} value={search.get("sort") ?? "due_asc"} onChange={(e) => update({ sort: e.target.value })}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {anyFilter && (
          <button
            type="button"
            onClick={() => update({ status: null, assignee: null, priority: null, due: null, kind: null, q: null })}
            className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition"
          >
            Clear all
          </button>
        )}

        <a
          href={exportHref}
          className="ml-auto h-9 px-md rounded-lg border border-outline-variant text-label-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition inline-flex items-center gap-xs"
          title="Download the filtered tasks as an Excel file (name, number, stage per consultant)"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            download
          </span>
          Export Excel
        </a>
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-auto scrollbar-thin max-h-[calc(100vh-260px)]">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-on-surface-variant sticky top-0 z-10 shadow-[0_1px_0_0_var(--lp-outline-variant)]">
              <tr>
                <Th className="text-left">Due</Th>
                <Th className="text-left">Priority</Th>
                <Th className="text-left">Task</Th>
                <Th className="text-left">Lead</Th>
                <Th className="text-left">Consultant</Th>
                <Th className="text-left">Lead status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-md py-lg text-center text-on-surface-variant">
                    No tasks match this filter.
                  </td>
                </tr>
              ) : (
                tasks.map((t) => {
                  const canEdit = access.isAdmin || (access.isBde && t.lead.assignedToId === access.userId);
                  const overdue = t.status === "open" && !!t.dueAt && new Date(t.dueAt).getTime() < today;
                  const done = t.status === "done";
                  const reinquiry = isReInquiryTask(t.subject);
                  return (
                    <tr key={t.id} className={"border-t border-outline-variant/60 hover:bg-surface-container-low" + (done ? " opacity-60" : "")}>
                      <Td className="whitespace-nowrap font-mono tabular-nums">
                        {t.dueAt ? (
                          <span className={overdue ? "text-error font-semibold" : "text-on-surface-variant"}>
                            {fmtDate(t.dueAt)}
                            {overdue && <span className="ml-xs text-[10px] uppercase font-bold">overdue</span>}
                          </span>
                        ) : (
                          <span className="text-on-surface-variant/50">—</span>
                        )}
                      </Td>
                      <Td>
                        <PriorityPill priority={t.priority} />
                      </Td>
                      <Td className="max-w-[22rem]">
                        <div className="flex items-center gap-xs">
                          {reinquiry && <ReInquiryBadge />}
                          <span className={"font-medium " + (done ? "line-through text-on-surface-variant" : "text-on-surface")} title={t.note ?? undefined}>
                            {t.subject}
                          </span>
                        </div>
                        {t.note && <span className="block text-label-sm text-on-surface-variant truncate">{t.note}</span>}
                      </Td>
                      <Td className="whitespace-nowrap font-semibold">
                        <Link href={`/crm/leads/${t.lead.id}`} className="text-on-surface hover:text-primary hover:underline">
                          {t.lead.candidateName}
                        </Link>
                        {t.lead.phone ? (
                          <a
                            href={`tel:${t.lead.phone}`}
                            className="block font-normal font-mono tabular-nums text-label-sm text-on-surface-variant hover:text-primary"
                          >
                            {t.lead.phone}
                          </a>
                        ) : (
                          <span className="block font-normal text-label-sm text-on-surface-variant/50">—</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {t.assignedToName ?? <span className="text-on-surface-variant">Unassigned</span>}
                      </Td>
                      <Td>
                        <LeadStatusPill status={t.lead.status} />
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-xs">
                          {canEdit && !done && (
                            <button
                              type="button"
                              onClick={() => setStatus(t, "done")}
                              className="inline-flex items-center gap-xs h-8 px-sm rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:text-green-700 hover:border-green-600/50 transition"
                              title="Mark done"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                              Done
                            </button>
                          )}
                          {canEdit && done && (
                            <button
                              type="button"
                              onClick={() => setStatus(t, "open")}
                              className="inline-flex items-center gap-xs h-8 px-sm rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:text-on-surface transition"
                              title="Reopen"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>undo</span>
                              Reopen
                            </button>
                          )}
                          {done && (
                            <span className="material-symbols-outlined text-green-600" style={{ fontSize: 18 }} title="Completed">
                              task_alt
                            </span>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTask(t);
                                setEditError(null);
                              }}
                              className="inline-flex items-center gap-xs h-8 px-sm rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:text-accent hover:border-accent/50 transition"
                              title="Edit task"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                              Edit
                            </button>
                          )}
                          <Link
                            href={`/crm/leads/${t.lead.id}`}
                            className="inline-flex p-xs text-on-surface-variant hover:text-accent transition"
                            title="Open lead"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>open_in_new</span>
                          </Link>
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-label-sm text-on-surface-variant">
        <span>{total === 0 ? "No tasks" : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
        <div className="flex items-center gap-base">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) }, true)}
            className="h-8 px-md rounded-lg border border-outline-variant disabled:opacity-40 hover:bg-surface-container-low transition"
          >
            Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => update({ page: String(page + 1) }, true)}
            className="h-8 px-md rounded-lg border border-outline-variant disabled:opacity-40 hover:bg-surface-container-low transition"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
