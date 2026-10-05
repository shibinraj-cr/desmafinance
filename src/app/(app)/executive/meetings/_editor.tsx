"use client";

import { useEffect, useState } from "react";
import { MultiSelect } from "@/components/MultiSelect";
import { formatIstShort } from "@/lib/lead-pulse-dates";
import {
  MEETING_KINDS,
  MEETING_KIND_LABEL,
  type MeetingKind,
  type MeetingRow,
  type ShareUser,
} from "@/lib/meeting-notes-model";
import { clearDraft, isStale, readDraft, writeDraft } from "@/lib/meeting-notes-draft";
import { Drawer, ErrorNote, Field, inputCls, primaryBtn, secondaryBtn } from "../wealth/editors";

/**
 * The meeting editor drawer, with autosaved drafts. Used by the admin page
 * (create, edit, share) and by My Workspace → Meetings for users a meeting was
 * shared with as editors (edit only — no sharing controls, and the server
 * ignores share fields from them regardless).
 */

// ── plumbing ────────────────────────────────────────────────────────────────

const API_ERRORS: Record<string, string> = {
  validation_error: "Please check the fields — a title and date are required, and every action item needs text.",
  not_found: "That meeting no longer exists, or you no longer have edit access — refresh the page.",
  unauthorized: "Your session expired. Sign in again.",
};

export async function call(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = typeof data.error === "string" ? data.error : "";
      return { ok: false, message: API_ERRORS[code] ?? data.message ?? "That didn't save. Try again." };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  }
}

// ── drafts ──────────────────────────────────────────────────────────────────

type ActionDraft = {
  key: string;
  id?: string;
  text: string;
  /** Free-text name, used only when no login is picked. */
  owner: string;
  /** "" = no login. */
  ownerUserId: string;
  dueOn: string;
  done: boolean;
};
type MeetingDraft = {
  title: string;
  meetingOn: string;
  kind: MeetingKind;
  attendees: string;
  agenda: string;
  notes: string;
  decisions: string;
  actions: ActionDraft[];
  /** Read-only shares (user ids). */
  sharedWith: string[];
  /** Edit shares (user ids) — disjoint from sharedWith in the form. */
  editors: string[];
};

let draftSeq = 0;
const newKey = () => `new-${++draftSeq}`;

function emptyDraft(today: string): MeetingDraft {
  return {
    title: "",
    meetingOn: today,
    kind: "leadership",
    attendees: "",
    agenda: "",
    notes: "",
    decisions: "",
    actions: [],
    sharedWith: [],
    editors: [],
  };
}

function draftFrom(m: MeetingRow): MeetingDraft {
  return {
    title: m.title,
    meetingOn: m.meetingOn,
    kind: (MEETING_KINDS as readonly string[]).includes(m.kind) ? (m.kind as MeetingKind) : "other",
    attendees: m.attendees ?? "",
    agenda: m.agenda ?? "",
    notes: m.notes ?? "",
    decisions: m.decisions ?? "",
    actions: m.actions.map((a) => ({
      key: a.id,
      id: a.id,
      text: a.text,
      owner: a.owner ?? "",
      ownerUserId: a.ownerUserId ?? "",
      dueOn: a.dueOn ?? "",
      done: a.done,
    })),
    sharedWith: m.sharedWith.filter((u) => !u.canEdit).map((u) => u.id),
    editors: m.sharedWith.filter((u) => u.canEdit).map((u) => u.id),
  };
}

/**
 * A draft read back from storage may come from an older build or a different
 * tab: fill any missing field from an empty draft, and give action rows fresh
 * keys — the `new-N` counter restarts on reload, so stored keys could collide.
 */
function reviveDraft(stored: Partial<MeetingDraft>, today: string): MeetingDraft {
  const base = emptyDraft(today);
  return {
    ...base,
    ...stored,
    sharedWith: Array.isArray(stored.sharedWith) ? stored.sharedWith : [],
    editors: Array.isArray(stored.editors) ? stored.editors : [],
    actions: Array.isArray(stored.actions)
      ? stored.actions.map((a) => ({ ...a, ownerUserId: a.ownerUserId ?? "", key: a.id ?? newKey() }))
      : [],
  };
}

export const timeFmt = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

function payloadFrom(d: MeetingDraft, includeShares: boolean) {
  return {
    title: d.title,
    meetingOn: d.meetingOn,
    kind: d.kind,
    attendees: d.attendees,
    agenda: d.agenda,
    notes: d.notes,
    decisions: d.decisions,
    // A row the user added and never typed into is noise, not an error.
    actions: d.actions
      .filter((a) => a.text.trim())
      .map((a) => ({
        id: a.id,
        text: a.text,
        owner: a.ownerUserId ? null : a.owner || null,
        ownerUserId: a.ownerUserId || null,
        dueOn: a.dueOn || null,
        done: a.done,
      })),
    ...(includeShares ? { sharedWith: [...d.sharedWith, ...d.editors], editors: d.editors } : {}),
  };
}

// ── editor ──────────────────────────────────────────────────────────────────

type Editing = {
  id: string | null;
  draft: MeetingDraft;
  /** The meeting's updatedAt when editing began, for the stale-draft check. */
  base: string | null;
  /** Set on the first keystroke (or a restore) — only then is there a draft worth keeping. */
  touched: boolean;
};

function openState(meeting: MeetingRow | null, today: string): { editing: Editing; savedAt: string | null; note: string | null } {
  const stored = readDraft<MeetingDraft>(meeting?.id ?? null);
  if (!meeting) {
    return {
      editing: { id: null, draft: stored ? reviveDraft(stored.draft, today) : emptyDraft(today), base: null, touched: !!stored },
      savedAt: stored?.savedAt ?? null,
      note: stored ? `Restored your unsaved draft from ${timeFmt.format(new Date(stored.savedAt))}.` : null,
    };
  }
  return {
    editing: {
      id: meeting.id,
      draft: stored ? reviveDraft(stored.draft, today) : draftFrom(meeting),
      base: stored ? stored.base : meeting.updatedAt,
      touched: !!stored,
    },
    savedAt: stored?.savedAt ?? null,
    note: stored
      ? `Restored your unsaved changes from ${timeFmt.format(new Date(stored.savedAt))}.` +
        (isStale(stored, meeting.updatedAt) ? " This meeting has been edited since — saving will overwrite those edits." : "")
      : null,
  };
}

/**
 * Mount it to open it (`{open && <MeetingEditor … />}`): the draft is read from
 * storage once, on mount, which only ever happens in the browser.
 */
export function MeetingEditor({
  meeting,
  today,
  ownerChoices,
  shareChoices,
  onClose,
  onSaved,
}: {
  /** null = a new meeting. */
  meeting: MeetingRow | null;
  today: string;
  /** Logins an action item can be assigned to. */
  ownerChoices: ShareUser[];
  /** Admins only: logins the meeting can be shared with. Omit to hide sharing. */
  shareChoices?: ShareUser[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [initial] = useState(() => openState(meeting, today));
  const [editing, setEditing] = useState<Editing>(initial.editing);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(initial.savedAt);
  const restoredNote = initial.note;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Autosave: write the draft shortly after typing pauses. Changing `editing`
  // again cancels the pending write, so a burst of keystrokes is one write.
  useEffect(() => {
    if (!editing.touched) return;
    const t = window.setTimeout(() => {
      const at = writeDraft(editing.id, editing.draft, editing.base);
      if (at) setDraftSavedAt(at);
    }, 800);
    return () => window.clearTimeout(t);
  }, [editing]);

  /** Close, keeping the draft — flushed now so the debounce can't lose the last keystrokes. */
  function close() {
    if (saving) return;
    if (editing.touched) writeDraft(editing.id, editing.draft, editing.base);
    onClose();
  }

  function discard() {
    if (!window.confirm("Discard this draft? What you typed since the last save will be lost.")) return;
    clearDraft(editing.id);
    onClose();
  }

  async function save() {
    setSaving(true);
    setError(null);
    const body = payloadFrom(editing.draft, !!shareChoices);
    const res = editing.id
      ? await call(`/api/executive/meetings/${editing.id}`, "PUT", body)
      : await call("/api/executive/meetings", "POST", body);
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    const id = editing.id ?? (typeof res.data.id === "string" ? res.data.id : null);
    clearDraft(editing.id);
    if (id) onSaved(id);
    else onClose();
  }

  const setDraft = (patch: Partial<MeetingDraft>) =>
    setEditing((e) => ({ ...e, touched: true, draft: { ...e.draft, ...patch } }));
  const setAction = (key: string, patch: Partial<ActionDraft>) =>
    setEditing((e) => ({
      ...e,
      touched: true,
      draft: { ...e.draft, actions: e.draft.actions.map((a) => (a.key === key ? { ...a, ...patch } : a)) },
    }));

  const { draft } = editing;
  const ownerNames = new Map(
    (meeting?.actions ?? []).filter((a) => a.ownerUserId).map((a) => [a.ownerUserId!, a.ownerName ?? "Current owner"]),
  );
  const shareOptions = (shareChoices ?? []).map((u) => ({ value: u.id, label: u.username }));

  return (
    <Drawer
      open
      title={editing.id ? "Edit meeting" : "New meeting"}
      eyebrow="Meeting Notes"
      onClose={close}
      footer={
        <>
          <button type="button" onClick={save} disabled={saving} className={primaryBtn}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={close} disabled={saving} className={secondaryBtn}>
            Close
          </button>
          {editing.touched && (
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="h-10 px-md rounded-lg text-error text-label-sm font-semibold hover:bg-error-container/40 disabled:opacity-60"
            >
              Discard
            </button>
          )}
          {editing.touched && draftSavedAt && (
            <span className="ml-auto text-caption text-on-surface-variant inline-flex items-center gap-xs">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                check_circle
              </span>
              Draft saved {timeFmt.format(new Date(draftSavedAt))}
            </span>
          )}
        </>
      }
    >
      <ErrorNote message={error} />
      {restoredNote && (
        <p className="text-body-md text-on-surface bg-primary/10 border border-primary/30 rounded-lg px-md py-sm">
          {restoredNote}
        </p>
      )}
      <Field label="Title">
        <input
          className={inputCls}
          value={draft.title}
          onChange={(e) => setDraft({ title: e.target.value })}
          placeholder="Monthly leadership review"
          autoFocus
        />
      </Field>
      <div className="grid grid-cols-2 gap-md">
        <Field label="Date">
          <input
            type="date"
            className={inputCls}
            value={draft.meetingOn}
            onChange={(e) => setDraft({ meetingOn: e.target.value })}
          />
        </Field>
        <Field label="Type">
          <select
            className={inputCls}
            value={draft.kind}
            onChange={(e) => setDraft({ kind: e.target.value as MeetingKind })}
          >
            {MEETING_KINDS.map((k) => (
              <option key={k} value={k}>
                {MEETING_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {shareChoices && (
        <>
          <Field label="Share — can view" hint="They read it under My Workspace → Meetings.">
            <MultiSelect
              options={shareOptions}
              selected={draft.sharedWith}
              onChange={(sharedWith) =>
                setDraft({ sharedWith, editors: draft.editors.filter((u) => !sharedWith.includes(u)) })
              }
              placeholder="Nobody"
              icon="visibility"
              searchable
              className="w-full"
            />
          </Field>
          <Field
            label="Share — can edit"
            hint="They can also edit the notes and action items. They can't delete it or change who it's shared with."
          >
            <MultiSelect
              options={shareOptions}
              selected={draft.editors}
              onChange={(editors) =>
                setDraft({ editors, sharedWith: draft.sharedWith.filter((u) => !editors.includes(u)) })
              }
              placeholder="Nobody"
              icon="edit"
              searchable
              className="w-full"
            />
          </Field>
        </>
      )}
      <Field label="Attendees" hint="Comma-separated. Anyone — they don't need a login.">
        <input className={inputCls} value={draft.attendees} onChange={(e) => setDraft({ attendees: e.target.value })} />
      </Field>
      <TextArea label="Agenda" rows={3} value={draft.agenda} onChange={(agenda) => setDraft({ agenda })} />
      <TextArea
        label="Notes"
        rows={8}
        value={draft.notes}
        onChange={(notes) => setDraft({ notes })}
        hint="Supports ## headings, - bullets, 1. lists and **bold**."
      />
      <TextArea
        label="Decisions"
        rows={4}
        value={draft.decisions}
        onChange={(decisions) => setDraft({ decisions })}
        hint="One per line as - bullets reads best."
      />

      <div className="space-y-sm">
        <div className="flex items-center justify-between">
          <span className="text-label-sm text-on-surface-variant">Action items</span>
          <button
            type="button"
            onClick={() =>
              setDraft({
                actions: [
                  ...draft.actions,
                  { key: newKey(), text: "", owner: "", ownerUserId: "", dueOn: "", done: false },
                ],
              })
            }
            className="text-accent text-label-sm font-semibold hover:underline"
          >
            + Add item
          </button>
        </div>
        {draft.actions.length === 0 && <p className="text-caption text-on-surface-variant">No action items.</p>}
        {draft.actions.map((a) => (
          <div key={a.key} className="rounded-lg border border-outline-variant p-sm space-y-sm">
            <div className="flex items-start gap-sm">
              <input
                type="checkbox"
                className="mt-3 h-4 w-4 accent-primary"
                checked={a.done}
                onChange={(e) => setAction(a.key, { done: e.target.checked })}
                aria-label="Done"
              />
              <input
                className={inputCls}
                value={a.text}
                onChange={(e) => setAction(a.key, { text: e.target.value })}
                placeholder="What needs to happen"
              />
              <button
                type="button"
                onClick={() => setDraft({ actions: draft.actions.filter((x) => x.key !== a.key) })}
                aria-label="Remove action item"
                className="h-10 w-10 shrink-0 grid place-items-center rounded-lg hover:bg-surface-container-low text-on-surface-variant"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  delete
                </span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-sm pl-6">
              <select
                className={inputCls}
                value={a.ownerUserId}
                onChange={(e) => setAction(a.key, { ownerUserId: e.target.value })}
                aria-label="Owner"
              >
                <option value="">Owner: no login</option>
                {ownerChoices.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}
                  </option>
                ))}
                {/* Keep a current owner selectable even if they're outside the
                    choices (e.g. an admin assigned them), so saving doesn't drop them. */}
                {a.ownerUserId && !ownerChoices.some((u) => u.id === a.ownerUserId) && (
                  <option value={a.ownerUserId}>{ownerNames.get(a.ownerUserId) ?? "Current owner"}</option>
                )}
              </select>
              <input
                type="date"
                className={inputCls}
                value={a.dueOn}
                onChange={(e) => setAction(a.key, { dueOn: e.target.value })}
                aria-label="Due date"
              />
            </div>
            {!a.ownerUserId && (
              <div className="pl-6">
                <input
                  className={inputCls}
                  value={a.owner}
                  onChange={(e) => setAction(a.key, { owner: e.target.value })}
                  placeholder="Or type a name (no reminders)"
                />
              </div>
            )}
            {a.ownerUserId && a.dueOn && !a.done && (
              <p className="pl-6 text-caption text-on-surface-variant inline-flex items-center gap-xs">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                  notifications_active
                </span>
                Reminder pops up for them from {formatIstShort(a.dueOn)} until they update it.
              </p>
            )}
          </div>
        ))}
      </div>
    </Drawer>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md"
      />
    </Field>
  );
}
