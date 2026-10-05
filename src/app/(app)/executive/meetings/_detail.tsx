"use client";

import { Markdown } from "@/components/hiring/Markdown";
import { formatIstShort } from "@/lib/lead-pulse-dates";
import {
  actionState,
  meetingKindLabel,
  ownerLabel,
  type ActionState,
  type MeetingActionRow,
  type MeetingRow,
} from "@/lib/meeting-notes-model";

/**
 * The read view of one meeting. Shared by the admin page (with edit, delete
 * and tick-off handlers) and My Workspace → Meetings (without them — a shared
 * reader sees the record, never a control that would 403).
 */

const STATE_CHIP: Record<ActionState, { label: string; cls: string }> = {
  overdue: {
    label: "Overdue",
    cls: "bg-error-container text-on-error-container",
  },
  due_today: { label: "Due today", cls: "bg-primary/20 text-on-surface" },
  open: {
    label: "Open",
    cls: "bg-surface-container-high text-on-surface-variant",
  },
  done: {
    label: "Done",
    cls: "bg-primary-container text-on-primary-container",
  },
};

export function StateChip({ state }: { state: ActionState }) {
  const s = STATE_CHIP[state];
  return (
    <span className={"inline-flex items-center px-sm h-6 rounded-full text-caption font-semibold " + s.cls}>
      {s.label}
    </span>
  );
}

export function MeetingDetail({
  meeting: m,
  today,
  onEdit,
  onDelete,
  onToggle,
  canToggle,
}: {
  meeting: MeetingRow;
  today: string;
  /** Omit all three for the read-only view. */
  onEdit?: () => void;
  onDelete?: () => void;
  onToggle?: (id: string, done: boolean) => void;
  /** Narrows onToggle to some items — My Workspace lets an owner tick only their own. */
  canToggle?: (a: MeetingActionRow) => boolean;
}) {
  const byline = [
    m.createdBy ? `Recorded by ${m.createdBy}` : null,
    m.updatedBy && m.updatedBy !== m.createdBy ? `last edited by ${m.updatedBy}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <article className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg space-y-lg min-w-0">
      <header className="flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0">
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            {meetingKindLabel(m.kind)} · {formatIstShort(m.meetingOn)}
          </p>
          <h3 className="text-h2 text-on-surface break-words">{m.title}</h3>
          {m.attendees && (
            <p className="text-body-md text-on-surface-variant mt-xs">
              <span className="font-semibold">Attendees:</span> {m.attendees}
            </p>
          )}
          {byline && <p className="text-caption text-on-surface-variant mt-xs">{byline}</p>}
          {m.sharedWith.length > 0 && (
            <p className="text-caption text-on-surface-variant mt-xs inline-flex items-center gap-xs">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                group
              </span>
              Shared with {m.sharedWith.map((u) => (u.canEdit ? `${u.username} (can edit)` : u.username)).join(", ")}
            </p>
          )}
        </div>
        {(onEdit || onDelete) && (
          <div className="flex items-center gap-sm">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
              >
                Edit
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                aria-label="Delete meeting"
                className="h-10 w-10 grid place-items-center rounded-lg border border-outline-variant text-error hover:bg-error-container/40"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  delete
                </span>
              </button>
            )}
          </div>
        )}
      </header>

      <NoteBlock title="Agenda" body={m.agenda} />
      <NoteBlock title="Notes" body={m.notes} />
      <NoteBlock title="Decisions" body={m.decisions} />

      <div>
        <h4 className="text-label-sm uppercase tracking-wider text-on-surface-variant mb-sm">Action items</h4>
        {m.actions.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">None recorded.</p>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {m.actions.map((a: MeetingActionRow) => {
              const state = actionState(a, today);
              return (
                <li key={a.id} className="flex items-start gap-md py-sm">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={a.done}
                    disabled={!onToggle || (canToggle ? !canToggle(a) : false)}
                    onChange={(e) => onToggle?.(a.id, e.target.checked)}
                    aria-label={`Mark "${a.text}" ${a.done ? "not done" : "done"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        "text-body-md " +
                        (a.done ? "line-through text-on-surface-variant" : "text-on-surface")
                      }
                    >
                      {a.text}
                    </p>
                    {(ownerLabel(a) || a.dueOn) && (
                      <p className="text-caption text-on-surface-variant">
                        {[ownerLabel(a), a.dueOn ? `Due ${formatIstShort(a.dueOn)}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <StateChip state={state} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </article>
  );
}

function NoteBlock({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;
  return (
    <div>
      <h4 className="text-label-sm uppercase tracking-wider text-on-surface-variant mb-sm">{title}</h4>
      <Markdown source={body} />
    </div>
  );
}
