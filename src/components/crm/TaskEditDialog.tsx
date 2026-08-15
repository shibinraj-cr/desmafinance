"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Edit an existing follow-up task in place (PATCH), instead of the old
 * delete-and-recreate workaround. Used from both the single-lead Tasks tab
 * (TaskItem) and the cross-lead Tasks board.
 *
 * Unlike the create-time composer, Subject here is a free-text input rather
 * than the fixed TASK_TYPES <select> — many tasks carry system-generated
 * subjects (re-inquiry follow-ups, re-enrollment prompts, etc.) that aren't
 * one of the four create-time options, so a closed list would have no
 * matching option to pre-select for most existing tasks.
 */

const inputCls =
  "w-full h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition";
const textareaCls =
  "w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition resize-y";

/** ISO datetime -> yyyy-mm-dd for the date input's value (local calendar day, same convention as NextStepDialog). */
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type TaskEditPayload = {
  subject: string;
  dueAt: string | null;
  priority: string;
  assignedToId: string | null;
  note: string | null;
};

export function TaskEditDialog({
  task,
  bdes,
  busy = false,
  error,
  onCancel,
  onSubmit,
}: {
  task: { subject: string; dueAt: string | null; priority: string; assignedToId: string | null; note: string | null };
  bdes: { userId: string; displayName: string }[];
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (payload: TaskEditPayload) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [subject, setSubject] = useState(task.subject);
  const [due, setDue] = useState(toDateInput(task.dueAt));
  const [priority, setPriority] = useState(task.priority);
  const [assignee, setAssignee] = useState(task.assignedToId ?? "");
  const [note, setNote] = useState(task.note ?? "");

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  if (!mounted) return null;

  function submit() {
    if (!subject.trim() || busy) return;
    onSubmit({
      subject: subject.trim(),
      dueAt: due || null,
      priority,
      assignedToId: assignee || null,
      note: note.trim() || null,
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => !busy && onCancel()}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
      >
        <div>
          <h3 className="text-h3 text-on-surface">Edit task</h3>
        </div>

        <div className="space-y-sm">
          <div>
            <label className="mb-[3px] block text-caption font-semibold uppercase tracking-wider text-on-surface-variant">
              Subject
            </label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-base">
            <div>
              <label className="mb-[3px] block text-caption font-semibold uppercase tracking-wider text-on-surface-variant">
                Due date
              </label>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-[3px] block text-caption font-semibold uppercase tracking-wider text-on-surface-variant">
                Priority
              </label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-[3px] block text-caption font-semibold uppercase tracking-wider text-on-surface-variant">
              Assignee
            </label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputCls}>
              <option value="">Unassigned</option>
              {bdes.map((b) => (
                <option key={b.userId} value={b.userId}>
                  {b.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-[3px] block text-caption font-semibold uppercase tracking-wider text-on-surface-variant">
              Note
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note (optional)…"
              rows={3}
              className={textareaCls}
            />
          </div>
        </div>

        {error && <p className="text-label-sm text-error">{error}</p>}

        <div className="flex justify-end gap-sm pt-xs">
          <button
            type="button"
            onClick={() => !busy && onCancel()}
            disabled={busy}
            className="h-9 px-lg rounded-lg border border-outline-variant text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!subject.trim() || busy}
            className="h-9 px-lg rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:opacity-90 disabled:opacity-50 transition"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
