"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Markdown } from "@/components/hiring/Markdown";
import { formatIstShort } from "@/lib/lead-pulse-dates";
import {
  MEETING_KINDS,
  MEETING_KIND_LABEL,
  actionState,
  meetingKindLabel,
  meetingMatches,
  openActions,
  type ActionState,
  type MeetingActionRow,
  type MeetingKind,
  type MeetingRow,
} from "@/lib/meeting-notes-model";
import { clearDraft, isStale, listDraftIds, readDraft, writeDraft } from "@/lib/meeting-notes-draft";
import { Drawer, ErrorNote, Field, inputCls, primaryBtn, secondaryBtn } from "../wealth/editors";

// ── plumbing ────────────────────────────────────────────────────────────────

const API_ERRORS: Record<string, string> = {
  validation_error: "Please check the fields — a title and date are required, and every action item needs text.",
  not_found: "That meeting no longer exists — refresh the page.",
  forbidden: "You don't have access to this page.",
  unauthorized: "Your session expired. Sign in again.",
};

async function call(
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

const STATE_CHIP: Record<ActionState, { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "bg-error-container text-on-error-container" },
  due_today: { label: "Due today", cls: "bg-primary/20 text-on-surface" },
  open: { label: "Open", cls: "bg-surface-container-high text-on-surface-variant" },
  done: { label: "Done", cls: "bg-primary-container text-on-primary-container" },
};

function StateChip({ state }: { state: ActionState }) {
  const s = STATE_CHIP[state];
  return (
    <span className={"inline-flex items-center px-sm h-6 rounded-full text-caption font-semibold " + s.cls}>
      {s.label}
    </span>
  );
}

// ── drafts ──────────────────────────────────────────────────────────────────

type ActionDraft = { key: string; id?: string; text: string; owner: string; dueOn: string; done: boolean };
type MeetingDraft = {
  title: string;
  meetingOn: string;
  kind: MeetingKind;
  attendees: string;
  agenda: string;
  notes: string;
  decisions: string;
  actions: ActionDraft[];
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
      dueOn: a.dueOn ?? "",
      done: a.done,
    })),
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
    actions: Array.isArray(stored.actions)
      ? stored.actions.map((a) => ({ ...a, key: a.id ?? newKey() }))
      : [],
  };
}

const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function payloadFrom(d: MeetingDraft) {
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
        owner: a.owner || null,
        dueOn: a.dueOn || null,
        done: a.done,
      })),
  };
}

// ── page ────────────────────────────────────────────────────────────────────

export function MeetingNotesClient({
  meetings,
  today,
  initialSelectedId,
}: {
  meetings: MeetingRow[];
  today: string;
  initialSelectedId: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId && meetings.some((m) => m.id === initialSelectedId)
      ? initialSelectedId
      : (meetings[0]?.id ?? null),
  );

  const [editing, setEditing] = useState<{
    id: string | null;
    draft: MeetingDraft;
    /** The meeting's updatedAt when editing began, for the stale-draft check. */
    base: string | null;
    /** Set on the first keystroke (or a restore) — only then is there a draft worth keeping. */
    touched: boolean;
  } | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [restoredNote, setRestoredNote] = useState<string | null>(null);
  // Read after mount: localStorage does not exist during the server render.
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set());
  useEffect(() => setDraftIds(listDraftIds()), []);

  // Autosave: write the draft shortly after typing pauses. Changing `editing`
  // again cancels the pending write, so a burst of keystrokes is one write.
  useEffect(() => {
    if (!editing?.touched) return;
    const t = window.setTimeout(() => {
      const at = writeDraft(editing.id, editing.draft, editing.base);
      if (at) setDraftSavedAt(at);
    }, 800);
    return () => window.clearTimeout(t);
  }, [editing]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [showAllOpen, setShowAllOpen] = useState(false);

  const filtered = useMemo(
    () => meetings.filter((m) => (kind === "all" || m.kind === kind) && meetingMatches(m, query)),
    [meetings, kind, query],
  );
  const selected = meetings.find((m) => m.id === selectedId) ?? filtered[0] ?? null;
  const pending = useMemo(() => openActions(meetings, today), [meetings, today]);
  const overdueCount = pending.filter((a) => a.state === "overdue").length;

  function select(id: string) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("m", id);
    window.history.replaceState(null, "", url);
  }

  function openNew() {
    setError(null);
    const stored = readDraft<MeetingDraft>(null);
    setDraftSavedAt(stored?.savedAt ?? null);
    setRestoredNote(stored ? `Restored your unsaved draft from ${timeFmt.format(new Date(stored.savedAt))}.` : null);
    setEditing({
      id: null,
      draft: stored ? reviveDraft(stored.draft, today) : emptyDraft(today),
      base: null,
      touched: !!stored,
    });
  }

  function openEdit(m: MeetingRow) {
    setError(null);
    const stored = readDraft<MeetingDraft>(m.id);
    setDraftSavedAt(stored?.savedAt ?? null);
    setRestoredNote(
      stored
        ? `Restored your unsaved changes from ${timeFmt.format(new Date(stored.savedAt))}.` +
            (isStale(stored, m.updatedAt)
              ? " This meeting has been edited since — saving will overwrite those edits."
              : "")
        : null,
    );
    setEditing({
      id: m.id,
      draft: stored ? reviveDraft(stored.draft, today) : draftFrom(m),
      base: stored ? stored.base : m.updatedAt,
      touched: !!stored,
    });
  }

  /** Close the drawer, keeping the draft — flushed now so the debounce can't lose the last keystrokes. */
  function closeEditor() {
    if (saving) return;
    if (editing?.touched) writeDraft(editing.id, editing.draft, editing.base);
    setEditing(null);
    setDraftIds(listDraftIds());
  }

  function discardDraft() {
    if (!editing) return;
    if (!window.confirm("Discard this draft? What you typed since the last save will be lost.")) return;
    clearDraft(editing.id);
    setEditing(null);
    setDraftIds(listDraftIds());
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    const body = payloadFrom(editing.draft);
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
    setEditing(null);
    setDraftIds(listDraftIds());
    if (id) select(id);
    refresh();
  }

  async function remove(m: MeetingRow) {
    if (!window.confirm(`Delete "${m.title}" and its ${m.actions.length} action item(s)? This can't be undone.`)) {
      return;
    }
    const res = await call(`/api/executive/meetings/${m.id}`, "DELETE");
    if (!res.ok) {
      setToggleError(res.message);
      return;
    }
    clearDraft(m.id);
    setDraftIds(listDraftIds());
    setSelectedId(null);
    refresh();
  }

  async function toggle(actionId: string, done: boolean) {
    setToggleError(null);
    const res = await call(`/api/executive/meetings/actions/${actionId}`, "PATCH", { done });
    if (!res.ok) setToggleError(res.message);
    refresh();
  }

  const setDraft = (patch: Partial<MeetingDraft>) =>
    setEditing((e) => (e ? { ...e, touched: true, draft: { ...e.draft, ...patch } } : e));
  const setAction = (key: string, patch: Partial<ActionDraft>) =>
    setEditing((e) =>
      e
        ? {
            ...e,
            touched: true,
            draft: {
              ...e.draft,
              actions: e.draft.actions.map((a) => (a.key === key ? { ...a, ...patch } : a)),
            },
          }
        : e,
    );

  const visibleOpen = showAllOpen ? pending : pending.slice(0, 6);

  return (
    <>
      <TopBar
        title="Meeting Notes"
        subtitle="Notes · Decisions · Action items"
        action={
          <button type="button" onClick={openNew} className={primaryBtn + " inline-flex items-center gap-xs"}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              add
            </span>
            {draftIds.has("new") ? "Resume draft" : "New meeting"}
          </button>
        }
      />

      <div className="p-md md:p-margin space-y-lg">
        <ErrorNote message={toggleError} />

        {/* Open action items across every meeting */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg">
          <div className="flex flex-wrap items-baseline justify-between gap-sm mb-md">
            <h4 className="text-h3 text-on-surface">Open action items</h4>
            <span className="text-body-md text-on-surface-variant">
              {pending.length} open
              {overdueCount > 0 && <span className="text-error font-semibold"> · {overdueCount} overdue</span>}
            </span>
          </div>
          {pending.length === 0 ? (
            <p className="text-body-md text-on-surface-variant">
              Nothing outstanding. Action items you add to a meeting show up here until they&apos;re ticked off.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-outline-variant">
                {visibleOpen.map((a) => (
                  <li key={a.id} className="flex items-start gap-md py-sm">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-primary"
                      checked={false}
                      onChange={() => toggle(a.id, true)}
                      aria-label={`Mark "${a.text}" done`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-body-md text-on-surface">{a.text}</p>
                      <p className="text-caption text-on-surface-variant">
                        {a.owner ? `${a.owner} · ` : ""}
                        {a.dueOn ? `Due ${formatIstShort(a.dueOn)} · ` : ""}
                        <button
                          type="button"
                          onClick={() => select(a.meetingId)}
                          className="text-accent hover:underline"
                        >
                          {a.meetingTitle}
                        </button>
                      </p>
                    </div>
                    <StateChip state={a.state} />
                  </li>
                ))}
              </ul>
              {pending.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllOpen((v) => !v)}
                  className="mt-sm text-accent text-label-sm font-semibold hover:underline"
                >
                  {showAllOpen ? "Show fewer" : `Show all ${pending.length}`}
                </button>
              )}
            </>
          )}
        </section>

        <div className="grid gap-lg lg:grid-cols-[minmax(280px,360px)_1fr] items-start">
          {/* Meeting list */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-md space-y-md">
            <div className="flex flex-col gap-sm">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes, decisions, people…"
                className={inputCls}
              />
              <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
                <option value="all">All meeting types</option>
                {MEETING_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {MEETING_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>

            {meetings.length === 0 ? (
              <div className="py-lg text-center text-on-surface-variant space-y-sm">
                <p className="text-body-md">No meetings recorded yet.</p>
                <button type="button" onClick={openNew} className={secondaryBtn}>
                  Record the first one
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-lg text-center text-body-md text-on-surface-variant">No meetings match.</p>
            ) : (
              <ul className="space-y-xs max-h-[70vh] overflow-y-auto -mx-xs px-xs">
                {filtered.map((m) => {
                  const open = m.actions.filter((a) => !a.done).length;
                  const active = selected?.id === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => select(m.id)}
                        className={
                          "w-full text-left rounded-lg px-md py-sm border transition " +
                          (active
                            ? "border-primary bg-primary/5"
                            : "border-transparent hover:bg-surface-container-low")
                        }
                      >
                        <p className="text-body-md font-semibold text-on-surface truncate">{m.title}</p>
                        <p className="text-caption text-on-surface-variant">
                          {formatIstShort(m.meetingOn)} · {meetingKindLabel(m.kind)}
                          {open > 0 && ` · ${open} open`}
                          {draftIds.has(m.id) && <span className="text-accent font-semibold"> · Unsaved draft</span>}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Selected meeting */}
          {selected ? (
            <MeetingDetail
              meeting={selected}
              today={today}
              onEdit={() => openEdit(selected)}
              onDelete={() => remove(selected)}
              onToggle={toggle}
            />
          ) : (
            <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg text-center text-on-surface-variant">
              Select a meeting to read its notes.
            </section>
          )}
        </div>
      </div>

      <Drawer
        open={!!editing}
        title={editing?.id ? "Edit meeting" : "New meeting"}
        eyebrow="Meeting Notes"
        onClose={closeEditor}
        footer={
          <>
            <button type="button" onClick={save} disabled={saving} className={primaryBtn}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={closeEditor} disabled={saving} className={secondaryBtn}>
              Close
            </button>
            {editing?.touched && (
              <button
                type="button"
                onClick={discardDraft}
                disabled={saving}
                className="h-10 px-md rounded-lg text-error text-label-sm font-semibold hover:bg-error-container/40 disabled:opacity-60"
              >
                Discard
              </button>
            )}
            {editing?.touched && draftSavedAt && (
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
        {editing && (
          <>
            <ErrorNote message={error} />
            {restoredNote && (
              <p className="text-body-md text-on-surface bg-primary/10 border border-primary/30 rounded-lg px-md py-sm">
                {restoredNote}
              </p>
            )}
            <Field label="Title">
              <input
                className={inputCls}
                value={editing.draft.title}
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
                  value={editing.draft.meetingOn}
                  onChange={(e) => setDraft({ meetingOn: e.target.value })}
                />
              </Field>
              <Field label="Type">
                <select
                  className={inputCls}
                  value={editing.draft.kind}
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
            <Field label="Attendees" hint="Comma-separated. Anyone — they don't need a login.">
              <input
                className={inputCls}
                value={editing.draft.attendees}
                onChange={(e) => setDraft({ attendees: e.target.value })}
              />
            </Field>
            <TextArea
              label="Agenda"
              rows={3}
              value={editing.draft.agenda}
              onChange={(agenda) => setDraft({ agenda })}
            />
            <TextArea
              label="Notes"
              rows={8}
              value={editing.draft.notes}
              onChange={(notes) => setDraft({ notes })}
              hint="Supports ## headings, - bullets, 1. lists and **bold**."
            />
            <TextArea
              label="Decisions"
              rows={4}
              value={editing.draft.decisions}
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
                        ...editing.draft.actions,
                        { key: newKey(), text: "", owner: "", dueOn: "", done: false },
                      ],
                    })
                  }
                  className="text-accent text-label-sm font-semibold hover:underline"
                >
                  + Add item
                </button>
              </div>
              {editing.draft.actions.length === 0 && (
                <p className="text-caption text-on-surface-variant">No action items.</p>
              )}
              {editing.draft.actions.map((a) => (
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
                      onClick={() =>
                        setDraft({ actions: editing.draft.actions.filter((x) => x.key !== a.key) })
                      }
                      aria-label="Remove action item"
                      className="h-10 w-10 shrink-0 grid place-items-center rounded-lg hover:bg-surface-container-low text-on-surface-variant"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        delete
                      </span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-sm pl-6">
                    <input
                      className={inputCls}
                      value={a.owner}
                      onChange={(e) => setAction(a.key, { owner: e.target.value })}
                      placeholder="Owner"
                    />
                    <input
                      type="date"
                      className={inputCls}
                      value={a.dueOn}
                      onChange={(e) => setAction(a.key, { dueOn: e.target.value })}
                      aria-label="Due date"
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Drawer>
    </>
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

function MeetingDetail({
  meeting: m,
  today,
  onEdit,
  onDelete,
  onToggle,
}: {
  meeting: MeetingRow;
  today: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (id: string, done: boolean) => void;
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
        </div>
        <div className="flex items-center gap-sm">
          <button type="button" onClick={onEdit} className={secondaryBtn}>
            Edit
          </button>
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
        </div>
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
                    onChange={(e) => onToggle(a.id, e.target.checked)}
                    aria-label={`Mark "${a.text}" ${a.done ? "not done" : "done"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        "text-body-md " + (a.done ? "line-through text-on-surface-variant" : "text-on-surface")
                      }
                    >
                      {a.text}
                    </p>
                    {(a.owner || a.dueOn) && (
                      <p className="text-caption text-on-surface-variant">
                        {[a.owner, a.dueOn ? `Due ${formatIstShort(a.dueOn)}` : null].filter(Boolean).join(" · ")}
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
