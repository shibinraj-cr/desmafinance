"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  CHANNEL_LABELS,
  TASK_REMINDER_CHANNELS,
  reminderStatusLabel,
  type TaskReminderChannel,
} from "@/lib/crm-task-reminders";

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
  /** Omitted when the task carries no reminders, so a plain edit leaves them alone. */
  reminderChannels?: TaskReminderChannel[];
};

/** One armed reminder as the task row already reports it. */
export type ReminderState = {
  channel: string;
  status: string;
  fireAt: string;
  sentAt: string | null;
  skipReason: string | null;
};

export function TaskEditDialog({
  task,
  bdes,
  reminders,
  busy = false,
  error,
  onCancel,
  onSubmit,
}: {
  task: { subject: string; dueAt: string | null; priority: string; assignedToId: string | null; note: string | null };
  bdes: { userId: string; displayName: string }[];
  /**
   * This task's reminders, when the caller has them. No preview is offered here
   * — unlike the create-time composer, Subject is free text, so a per-task-type
   * template cannot be resolved for a system-generated subject. What CAN always
   * be done is turn a channel off, which is the thing a consultant comes here
   * for.
   */
  reminders?: ReminderState[];
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
  // Pre-ticked from what is actually armed. A sent reminder is a fact and is
  // shown rather than offered as a checkbox — there is nothing left to decide.
  const live = (reminders ?? []).filter((r) => r.status === "pending" || r.status === "sending");
  const settled = (reminders ?? []).filter((r) => r.status === "sent" || r.status === "failed" || r.status === "skipped");
  const [channels, setChannels] = useState<TaskReminderChannel[]>(
    live.map((r) => r.channel as TaskReminderChannel),
  );

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
      // Only sent when this task has reminders to speak for. Omitting it leaves
      // them untouched, so an edit from a screen that knows nothing about
      // reminders cannot silently disarm one.
      ...(reminders ? { reminderChannels: channels } : {}),
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

        {reminders && (reminders.length > 0 || channels.length > 0) && (
          <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md space-y-xs">
            <p className="text-caption font-semibold uppercase tracking-wider text-on-surface-variant">
              Automatic reminder
            </p>
            {TASK_REMINDER_CHANNELS.map((c) => {
              const done = settled.find((r) => r.channel === c);
              if (done) {
                return (
                  <p key={c} className="text-label-sm text-on-surface-variant">
                    {reminderStatusLabel(done)}
                  </p>
                );
              }
              return (
                <label key={c} className="flex items-center gap-sm cursor-pointer text-label-sm text-on-surface">
                  <input
                    type="checkbox"
                    checked={channels.includes(c)}
                    onChange={() =>
                      setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
                    }
                    className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/30"
                  />
                  {CHANNEL_LABELS[c]}
                </label>
              );
            })}
            <p className="text-label-sm text-on-surface-variant">
              Sent to the candidate the morning after the due date if this is still open.
            </p>
          </div>
        )}

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
