"use client";

import { useMemo } from "react";
import { fillTemplate } from "@/lib/crm";
import {
  CHANNEL_LABELS,
  SKIP_REASON_LABELS,
  TASK_REMINDER_CHANNELS,
  formatDueDate,
  type TaskReminderChannel,
  type ReminderSkipReason,
} from "@/lib/crm-task-reminders";

/**
 * The "remind the candidate anyway" block, shared by the task composer and the
 * task edit dialog.
 *
 * Two things it has to do, and the second is the harder one.
 *
 * SHOW WHAT WILL BE SENT. The whole premise is that nobody looks at this again —
 * a reminder fires a day later, unattended, in the consultant's absence. The one
 * moment to read the actual wording is now, so the preview is not a nicety.
 *
 * EXPLAIN A CHANNEL THAT CANNOT WORK. A lead with no email address, a candidate
 * who opted out, a template an admin never configured — each of those makes a
 * tick box a lie. They are disabled with the reason in plain words rather than
 * silently accepted and skipped a day later.
 */

export type ChannelPreviewDTO = {
  available: boolean;
  reason: ReminderSkipReason | null;
  subject: string | null;
  /** Lead fields already merged; `{task}` and `{due_date}` still to fill. */
  body: string | null;
};

export type TaskReminderPreviewDTO = {
  enabled: boolean;
  defaultChannels: TaskReminderChannel[];
  /** Consultants whose tasks may send reminders. Empty means nobody. */
  consultantIds: string[];
  byTaskType: Record<string, Record<TaskReminderChannel, ChannelPreviewDTO>>;
};

export function TaskReminderFields({
  preview,
  taskType,
  dueDate,
  assigneeId,
  selected,
  onChange,
}: {
  preview: TaskReminderPreviewDTO;
  /** The chosen task subject — decides which per-type wording applies. */
  taskType: string;
  /** The `YYYY-MM-DD` from the form, used to fill `{due_date}` live. */
  dueDate: string;
  /**
   * Who the task will belong to once saved. Reminders run per consultant, and
   * the composer's "Assign to" can change this while the form is open — so the
   * answer has to follow the dropdown rather than be settled on the server.
   */
  assigneeId: string | null;
  selected: TaskReminderChannel[];
  onChange: (next: TaskReminderChannel[]) => void;
}) {
  const channels = preview.byTaskType[taskType];

  // `{task}` and `{due_date}` are left unmerged by the server precisely so they
  // can follow the form as the consultant fills it in.
  const vars = useMemo(
    () => ({
      task: taskType,
      // A date the consultant has not picked yet renders as a placeholder rather
      // than an empty gap, so the preview never reads as a finished message with
      // a hole in it.
      due_date: dueDate ? formatDueDate(new Date(`${dueDate}T00:00:00.000Z`)) : "…",
    }),
    [taskType, dueDate],
  );

  if (!preview.enabled) return null;
  // No task type chosen yet — there is nothing to preview and nothing to arm.
  if (!taskType || !channels) return null;

  // The consultant gate. Said plainly rather than by showing two disabled
  // boxes: the reason is about who the task belongs to, and the fix is an admin
  // one, so a consultant hunting a missing email address would be looking in
  // entirely the wrong place.
  if (!assigneeId || !preview.consultantIds.includes(assigneeId)) {
    return (
      <p className="text-label-sm text-on-surface-variant inline-flex items-start gap-xs">
        <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 16 }} aria-hidden>
          info
        </span>
        <span>
          No automatic reminder: this task’s consultant isn’t set up for them. An admin can enable it under
          CRM → Templates → Task auto-reminders.
        </span>
      </p>
    );
  }

  function toggle(channel: TaskReminderChannel) {
    onChange(selected.includes(channel) ? selected.filter((c) => c !== channel) : [...selected, channel]);
  }

  const anyAvailable = TASK_REMINDER_CHANNELS.some((c) => channels[c]?.available);

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md space-y-sm">
      <div className="flex items-start gap-xs">
        <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }} aria-hidden>
          shield
        </span>
        <div>
          <p className="text-label-md font-semibold text-on-surface">If this isn’t done in time</p>
          <p className="text-label-sm text-on-surface-variant">
            The candidate is messaged automatically the morning after the due date. Completing the task
            cancels it.
          </p>
        </div>
      </div>

      {!anyAvailable && (
        <p className="text-label-sm text-on-surface-variant">
          No reminder can be sent for this lead — see the reasons below.
        </p>
      )}

      <div className="space-y-sm">
        {TASK_REMINDER_CHANNELS.map((channel) => {
          const c = channels[channel];
          if (!c) return null;
          const checked = c.available && selected.includes(channel);
          const rendered = c.body ? fillTemplate(c.body, vars) : null;
          return (
            <div key={channel} className="space-y-xs">
              <label
                className={
                  "flex items-center gap-sm text-body-md " +
                  (c.available ? "cursor-pointer text-on-surface" : "cursor-not-allowed text-on-surface-variant")
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!c.available}
                  onChange={() => toggle(channel)}
                  className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/30"
                />
                <span className="font-medium">{CHANNEL_LABELS[channel]}</span>
                {!c.available && c.reason && (
                  <span className="text-label-sm">— {SKIP_REASON_LABELS[c.reason]}</span>
                )}
              </label>

              {checked && (
                <div className="ml-[1.75rem] rounded-lg border border-outline-variant bg-surface-container-low p-sm">
                  <p className="text-label-sm text-on-surface-variant mb-xs">
                    This is what {CHANNEL_LABELS[channel] === "Email" ? "is emailed" : "is sent"}:
                  </p>
                  {c.subject && (
                    <p className="text-label-md font-semibold text-on-surface mb-xs">
                      {fillTemplate(c.subject, vars)}
                    </p>
                  )}
                  {rendered ? (
                    <p className="text-body-sm text-on-surface whitespace-pre-wrap">{rendered}</p>
                  ) : (
                    // A catalogue-only template: Meta holds the wording, we do
                    // not. Saying so beats showing an empty box that reads as a
                    // blank message.
                    <p className="text-label-sm text-on-surface-variant italic">
                      This template’s wording is held at Meta — DesGro has no local copy to preview.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
