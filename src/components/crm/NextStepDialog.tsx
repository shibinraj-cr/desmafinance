"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TASK_TYPES } from "@/lib/crm";
import { CHANNEL_LABELS, TASK_REMINDER_CHANNELS, type TaskReminderChannel } from "@/lib/crm-task-reminders";

/**
 * "Schedule the next step" dialog shown when a consultant completes the last
 * open task on a lead that is still in an active stage — the CRM rule is that an
 * active lead must always have a next action booked. Used by both the task board
 * and the lead detail page. It gathers the replacement task (subject / due /
 * priority); the caller sends it as `nextTask` alongside `{ status: "done" }` so
 * completion and the new task land atomically.
 */

const inputCls =
  "w-full h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition";
const textareaCls =
  "w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition resize-y";

/** Tomorrow as a yyyy-mm-dd string, the sensible default for a follow-up. */
function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type NextStepPayload = {
  subject: string;
  dueAt: string | null;
  priority: string;
  note: string | null;
  /** Omitted when reminders are off, so the server keeps its own defaults. */
  reminderChannels?: TaskReminderChannel[];
};

export function NextStepDialog({
  leadName,
  reminders,
  busy = false,
  error,
  onCancel,
  onSubmit,
}: {
  leadName?: string | null;
  /**
   * The auto-reminder defaults, when the caller knows them.
   *
   * This dialog is NOT optional — it appears because the consultant completed a
   * lead's last open task — and it defaults the due date to tomorrow. Without
   * this block a consultant would book a follow-up and, with it, a WhatsApp
   * message and an email to the candidate, having never been told. Saying so is
   * the difference between a safety net and something going out behind their
   * back.
   */
  reminders?: { enabled: boolean; defaultChannels: TaskReminderChannel[] };
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (payload: NextStepPayload) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [subject, setSubject] = useState<string>(TASK_TYPES[0]);
  const [due, setDue] = useState<string>(tomorrowISO());
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");
  const [channels, setChannels] = useState<TaskReminderChannel[]>(reminders?.defaultChannels ?? []);

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
      note: note.trim() || null,
      // Only sent when this screen actually showed the choice. Omitting it lets
      // the server apply its defaults, which is right for a caller that has not
      // been taught about reminders — but wrong here, where the consultant saw
      // the boxes and may have unticked them.
      ...(reminders?.enabled ? { reminderChannels: due ? channels : [] } : {}),
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => !busy && onCancel()}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
      >
        <div>
          <h3 className="text-h3 text-on-surface">Schedule the next step</h3>
          <p className="mt-xs text-label-sm text-on-surface-variant">
            {leadName ? <span className="font-semibold">{leadName}</span> : "This lead"} is still active and this is its last
            open task. Book the next action to complete this one.
          </p>
        </div>

        <div className="space-y-sm">
          <div>
            <label className="mb-[3px] block text-caption font-semibold uppercase tracking-wider text-on-surface-variant">
              Next task
            </label>
            <select value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} autoFocus>
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
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
              Note
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note for this follow-up (optional)…"
              rows={3}
              className={textareaCls}
            />
          </div>
        </div>

        {reminders?.enabled && due && (
          <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md space-y-xs">
            <p className="text-caption font-semibold uppercase tracking-wider text-on-surface-variant">
              If this isn’t done in time
            </p>
            <p className="text-label-sm text-on-surface-variant">
              The candidate is messaged automatically the morning after the due date. Completing the task
              cancels it.
            </p>
            {TASK_REMINDER_CHANNELS.map((c) => (
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
            ))}
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
            {busy ? "Completing…" : "Complete & schedule"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
