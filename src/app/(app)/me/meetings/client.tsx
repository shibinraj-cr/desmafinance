"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { formatIstShort } from "@/lib/lead-pulse-dates";
import {
  actionState,
  editorOwnerChoices,
  meetingKindLabel,
  meetingMatches,
  type MeetingRow,
  type ShareUser,
} from "@/lib/meeting-notes-model";
import { MeetingDetail, StateChip } from "../../executive/meetings/_detail";
import { MeetingEditor } from "../../executive/meetings/_editor";

export function MyMeetingsClient({
  meetings,
  today,
  self,
  initialSelectedId,
}: {
  meetings: MeetingRow[];
  today: string;
  self: ShareUser;
  initialSelectedId: string | null;
}) {
  const userId = self.id;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Open only for a meeting shared with this user as an editor. */
  const [editing, setEditing] = useState<MeetingRow | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId && meetings.some((m) => m.id === initialSelectedId)
      ? initialSelectedId
      : (meetings[0]?.id ?? null),
  );

  const filtered = useMemo(() => meetings.filter((m) => meetingMatches(m, query)), [meetings, query]);
  const selected = meetings.find((m) => m.id === selectedId) ?? filtered[0] ?? null;
  const mine = useMemo(
    () =>
      meetings
        .flatMap((m) =>
          m.actions
            .filter((a) => a.ownerUserId === userId && !a.done)
            .map((a) => ({ ...a, meetingId: m.id, meetingTitle: m.title, state: actionState(a, today) })),
        )
        .sort((x, y) => (x.dueOn ?? "9999").localeCompare(y.dueOn ?? "9999")),
    [meetings, userId, today],
  );

  function select(id: string) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("m", id);
    window.history.replaceState(null, "", url);
  }

  async function toggle(actionId: string, done: boolean) {
    setError(null);
    try {
      const res = await fetch(`/api/me/meeting-actions/${actionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: done ? "done" : "reopen" }),
      });
      if (!res.ok) setError("That didn't save. Refresh the page and try again.");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    startTransition(() => router.refresh());
  }

  return (
    <>
      <TopBar title="Meetings" subtitle="Shared with you" />
      <div className="p-md md:p-margin space-y-lg">
        {error && (
          <p className="text-body-md text-error bg-error-container/40 border border-error/30 rounded-lg px-md py-sm">
            {error}
          </p>
        )}

        {mine.length > 0 && (
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg">
            <h4 className="text-h3 text-on-surface mb-md">Your action items</h4>
            <ul className="divide-y divide-outline-variant">
              {mine.map((a) => (
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
                      {a.dueOn ? `Due ${formatIstShort(a.dueOn)} · ` : ""}
                      <button type="button" onClick={() => select(a.meetingId)} className="text-accent hover:underline">
                        {a.meetingTitle}
                      </button>
                    </p>
                  </div>
                  <StateChip state={a.state} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {meetings.length === 0 ? (
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg text-center text-on-surface-variant">
            No meetings have been shared with you yet.
          </section>
        ) : (
          <div className="grid gap-lg lg:grid-cols-[minmax(280px,360px)_1fr] items-start">
            <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-md space-y-md">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes, decisions…"
                className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md"
              />
              {filtered.length === 0 ? (
                <p className="py-lg text-center text-body-md text-on-surface-variant">No meetings match.</p>
              ) : (
                <ul className="space-y-xs max-h-[70vh] overflow-y-auto -mx-xs px-xs">
                  {filtered.map((m) => {
                    const active = selected?.id === m.id;
                    const own = m.actions.filter((a) => a.ownerUserId === userId && !a.done).length;
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => select(m.id)}
                          className={
                            "w-full text-left rounded-lg px-md py-sm border transition " +
                            (active ? "border-primary bg-primary/5" : "border-transparent hover:bg-surface-container-low")
                          }
                        >
                          <p className="text-body-md font-semibold text-on-surface truncate">{m.title}</p>
                          <p className="text-caption text-on-surface-variant">
                            {formatIstShort(m.meetingOn)} · {meetingKindLabel(m.kind)}
                            {own > 0 && <span className="text-accent font-semibold"> · {own} for you</span>}
                            {m.canEdit && " · You can edit"}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            {selected && (
              <MeetingDetail
                meeting={selected}
                today={today}
                onEdit={selected.canEdit ? () => setEditing(selected) : undefined}
                onToggle={toggle}
                canToggle={(a) => a.ownerUserId === userId}
              />
            )}
          </div>
        )}
      </div>

      {editing && (
        <MeetingEditor
          meeting={editing}
          today={today}
          ownerChoices={editorOwnerChoices(editing, self)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </>
  );
}
