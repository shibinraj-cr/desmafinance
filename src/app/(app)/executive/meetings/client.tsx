"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { formatIstShort } from "@/lib/lead-pulse-dates";
import {
  MEETING_KINDS,
  MEETING_KIND_LABEL,
  meetingKindLabel,
  meetingMatches,
  openActions,
  ownerLabel,
  type MeetingRow,
  type ShareUser,
} from "@/lib/meeting-notes-model";
import { clearDraft, listDraftIds } from "@/lib/meeting-notes-draft";
import { MeetingDetail, StateChip } from "./_detail";
import { MeetingEditor, call } from "./_editor";
import { ErrorNote, inputCls, primaryBtn, secondaryBtn } from "../wealth/editors";

// ── page ────────────────────────────────────────────────────────────────────

export function MeetingNotesClient({
  meetings,
  today,
  initialSelectedId,
  users,
}: {
  meetings: MeetingRow[];
  today: string;
  initialSelectedId: string | null;
  /** Active logins the meeting can be shared with. */
  users: ShareUser[];
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

  /** The editor is open on this meeting ("new" for a new one), or closed. */
  const [editing, setEditing] = useState<MeetingRow | "new" | null>(null);
  // Read after mount: localStorage does not exist during the server render.
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set());
  useEffect(() => setDraftIds(listDraftIds()), []);
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

  const openNew = () => setEditing("new");
  const openEdit = (m: MeetingRow) => setEditing(m);

  function closeEditor() {
    setEditing(null);
    setDraftIds(listDraftIds());
  }

  function onSaved(id: string) {
    closeEditor();
    select(id);
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
                        {ownerLabel(a) ? `${ownerLabel(a)} · ` : ""}
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
                          {m.sharedWith.length > 0 && ` · Shared with ${m.sharedWith.length}`}
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

      {editing && (
        <MeetingEditor
          meeting={editing === "new" ? null : editing}
          today={today}
          ownerChoices={users}
          shareChoices={users}
          onClose={closeEditor}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
