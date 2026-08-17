"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { WaComposer, type WaTemplateOpt } from "@/components/crm/WaComposer";

/**
 * The three-pane inbox: conversation list | thread | lead context.
 *
 * The right-hand rail is the whole argument for reading WhatsApp here instead of
 * in Wabis — stage, service, source and temperature sitting beside the message
 * being answered. Without it this is a worse WhatsApp client.
 */

type InboxRow = {
  id: string;
  phoneE164: string;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  sessionOpen: boolean;
  awaitingReply: boolean;
  preview: string | null;
  previewDirection: string | null;
  lead: { id: string; candidateName: string; statusLabel: string | null; statusColor: string | null } | null;
  assignedTo: { id: string; name: string } | null;
};

type ThreadMessage = {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  mediaMime: string | null;
  fileName: string | null;
  templateName: string | null;
  waStatus: string | null;
  waErrorCode: string | null;
  occurredAt: string;
  sentByName: string | null;
};

type Thread = {
  id: string;
  phoneE164: string;
  status: string;
  awaitingReply: boolean;
  lastInboundAt: string | null;
  sessionExpiresAt: string | null;
  sessionOpen: boolean;
  lead: {
    id: string;
    candidateName: string;
    email: string | null;
    phone: string | null;
    statusId: string | null;
    serviceId: string | null;
    sourceId: string | null;
    qualificationId: string | null;
    country: string | null;
    studyDestination: string | null;
    temperature: string | null;
    statusLabel: string | null;
    statusColor: string | null;
    serviceName: string | null;
    sourceLabel: string | null;
    qualificationLabel: string | null;
  } | null;
  assignedTo: { id: string; name: string } | null;
  messages: ThreadMessage[];
  truncated: boolean;
  duplicates: LeadDuplicate[];
  activity: { id: string; type: string; summary: string | null; occurredAt: string; actorName: string | null }[];
};

type LeadDuplicate = {
  id: string;
  candidateName: string;
  email: string | null;
  phone: string | null;
  matchedOn: string;
  status: { label: string; color: string | null };
};

export type InboxMasters = {
  statuses: { id: string; label: string; color: string | null }[];
  services: { id: string; label: string }[];
  sources: { id: string; label: string }[];
  qualifications: { id: string; label: string }[];
  countries: string[];
};

/** Re-exported so the page can keep importing its prop types from one place. */
type TemplateOpt = WaTemplateOpt;
type BdeOpt = { userId: string; displayName: string };

const FILTERS = [
  { key: "needs_reply", label: "Needs reply", countKey: "needsReply" as const },
  { key: "mine", label: "Mine", countKey: null },
  { key: "unread", label: "Unread", countKey: "unread" as const },
  { key: "unassigned", label: "Unassigned", countKey: "unassigned" as const },
  { key: "all", label: "All", countKey: null },
];

const WA_STATUS_GLYPH: Record<string, { icon: string; cls: string; label: string }> = {
  sent: { icon: "done", cls: "text-on-surface-variant", label: "Sent" },
  delivered: { icon: "done_all", cls: "text-on-surface-variant", label: "Delivered" },
  read: { icon: "done_all", cls: "text-primary", label: "Read" },
  failed: { icon: "error", cls: "text-error", label: "Failed" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

/** Remaining free-text window, or null once it has closed. */
function windowLeft(sessionExpiresAt: string | null): string | null {
  if (!sessionExpiresAt) return null;
  const ms = new Date(sessionExpiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return hrs > 0 ? `${hrs}h ${mins}m left` : `${mins}m left`;
}

export function InboxClient({
  initialFilter,
  initialConversationId,
  mirrorEnabled,
  providerLabel,
  canSendText,
  canSendTemplate,
  canAssign,
  templates,
  bdes,
  masters,
}: {
  /** From ?filter= — the sidebar ticker links to the slice it counted. */
  initialFilter: string | null;
  /** From ?conversation= — opens one thread directly. */
  initialConversationId: string | null;
  mirrorEnabled: boolean;
  providerLabel: string;
  canSendText: boolean;
  canSendTemplate: boolean;
  canAssign: boolean;
  templates: TemplateOpt[];
  bdes: BdeOpt[];
  masters: InboxMasters;
}) {
  // Only accept a filter the UI actually offers — a stray ?filter=foo would
  // otherwise leave the chips showing nothing selected.
  const [filter, setFilter] = useState(
    FILTERS.some((f) => f.key === initialFilter) ? (initialFilter as string) : "needs_reply",
  );
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [counts, setCounts] = useState({ needsReply: 0, unread: 0, unassigned: 0 });
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);

  const loadList = useCallback(async () => {
    setListLoading(true);
    const qs = new URLSearchParams({ filter });
    if (search.trim()) qs.set("q", search.trim());
    const res = await fetch(`/api/crm/wa/conversations?${qs}`).catch(() => null);
    setListLoading(false);
    if (!res?.ok) return;
    const d = (await res.json()) as { conversations: InboxRow[]; counts: typeof counts };
    setRows(d.conversations);
    setCounts(d.counts);
  }, [filter, search]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => void loadList(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadList, search]);

  return (
    <div className="space-y-base">
      {!mirrorEnabled && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md text-body-md text-on-surface-variant">
          <span className="font-semibold text-on-surface">The conversation mirror is off.</span> Existing threads are
          shown, but new messages are not being stored. Turn it on in CRM → Settings → Integrations.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_300px] gap-base h-[calc(100vh-200px)]">
        <ConversationList
          rows={rows}
          counts={counts}
          loading={listLoading}
          filter={filter}
          onFilter={setFilter}
          search={search}
          onSearch={setSearch}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <ThreadPane
          conversationId={selectedId}
          providerLabel={providerLabel}
          canSendText={canSendText}
          canSendTemplate={canSendTemplate}
          canAssign={canAssign}
          templates={templates}
          bdes={bdes}
          masters={masters}
          onChanged={loadList}
        />
      </div>
    </div>
  );
}

function ConversationList({
  rows,
  counts,
  loading,
  filter,
  onFilter,
  search,
  onSearch,
  selectedId,
  onSelect,
}: {
  rows: InboxRow[];
  counts: { needsReply: number; unread: number; unassigned: number };
  loading: boolean;
  filter: string;
  onFilter: (f: string) => void;
  search: string;
  onSearch: (s: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
      <div className="p-sm border-b border-outline-variant space-y-sm">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name or number…"
          className="w-full h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary outline-none"
        />
        <div className="flex flex-wrap gap-xs">
          {FILTERS.map((f) => {
            const count = f.countKey ? counts[f.countKey] : 0;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => onFilter(f.key)}
                className={
                  "px-sm h-7 rounded-full text-label-sm font-semibold transition inline-flex items-center gap-xs " +
                  (filter === f.key
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container")
                }
              >
                {f.label}
                {f.countKey && count > 0 && (
                  <span className={filter === f.key ? "opacity-80" : "text-primary font-bold"}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin">
        {loading && <p className="p-lg text-center text-label-sm text-on-surface-variant">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="p-lg text-center text-label-sm text-on-surface-variant">No conversations here.</p>
        )}
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            className={
              "w-full text-left px-md py-sm border-b border-outline-variant/60 transition " +
              (selectedId === r.id ? "bg-primary/10" : "hover:bg-surface-container-low")
            }
          >
            <div className="flex items-baseline justify-between gap-xs">
              <span className="text-body-md font-semibold text-on-surface truncate">
                {r.lead?.candidateName || r.phoneE164}
              </span>
              <span className="text-label-sm text-on-surface-variant shrink-0 tabular-nums">
                {fmtRelative(r.lastMessageAt)}
              </span>
            </div>
            <div className="flex items-center gap-xs mt-[2px]">
              {r.previewDirection === "out" && (
                <span className="material-symbols-outlined text-on-surface-variant shrink-0" style={{ fontSize: 13 }}>
                  reply
                </span>
              )}
              <span className="text-label-sm text-on-surface-variant truncate flex-1">{r.preview ?? "No messages"}</span>
              {r.unreadCount > 0 && (
                <span className="inline-grid place-items-center min-w-[18px] h-[18px] px-[5px] rounded-full text-[10px] font-bold bg-primary text-on-primary shrink-0">
                  {r.unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-xs mt-xs">
              {r.awaitingReply && (
                <span className="px-[6px] h-[17px] inline-flex items-center rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600">
                  awaiting reply
                </span>
              )}
              {r.lead?.statusLabel && (
                <span
                  className="px-[6px] h-[17px] inline-flex items-center rounded-full text-[10px] font-semibold"
                  style={{
                    backgroundColor: `${r.lead.statusColor ?? "#9aa0a6"}1a`,
                    color: r.lead.statusColor ?? "#9aa0a6",
                  }}
                >
                  {r.lead.statusLabel}
                </span>
              )}
              {!r.lead && (
                <span className="px-[6px] h-[17px] inline-flex items-center rounded-full text-[10px] font-semibold bg-surface-container text-on-surface-variant">
                  no lead
                </span>
              )}
              {r.assignedTo && <span className="text-[10px] text-on-surface-variant ml-auto">{r.assignedTo.name}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ThreadPane({
  conversationId,
  providerLabel,
  canSendText,
  canSendTemplate,
  canAssign,
  templates,
  bdes,
  masters,
  onChanged,
}: {
  conversationId: string | null;
  providerLabel: string;
  canSendText: boolean;
  canSendTemplate: boolean;
  canAssign: boolean;
  templates: TemplateOpt[];
  bdes: BdeOpt[];
  masters: InboxMasters;
  onChanged: () => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [canAct, setCanAct] = useState(false);
  const [loading, setLoading] = useState(false);
  /** Text the user highlighted in the thread — the source for "use this as…". */
  const [selection, setSelection] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!conversationId) {
      setThread(null);
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/crm/wa/conversations/${conversationId}`).catch(() => null);
    setLoading(false);
    if (!res?.ok) return;
    const d = (await res.json()) as { conversation: Thread; canAct: boolean };
    setThread(d.conversation);
    setCanAct(d.canAct);
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);

  if (!conversationId) {
    return (
      <div className="lg:col-span-2 grid place-items-center rounded-xl border border-outline-variant bg-surface-container-lowest text-on-surface-variant">
        Select a conversation.
      </div>
    );
  }

  if (loading && !thread) {
    return (
      <div className="lg:col-span-2 grid place-items-center rounded-xl border border-outline-variant bg-surface-container-lowest text-on-surface-variant">
        Loading…
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="lg:col-span-2 grid place-items-center rounded-xl border border-outline-variant bg-surface-container-lowest text-error">
        Couldn’t load this conversation.
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
        <div className="px-md py-sm border-b border-outline-variant flex items-center justify-between gap-sm">
          <div className="min-w-0">
            <p className="text-body-md font-semibold text-on-surface truncate">
              {thread.lead?.candidateName || thread.phoneE164}
            </p>
            <p className="text-label-sm text-on-surface-variant font-mono tabular-nums">{thread.phoneE164}</p>
          </div>
          <SessionPill sessionOpen={thread.sessionOpen} sessionExpiresAt={thread.sessionExpiresAt} />
        </div>

        {/* Capture-from-message. The candidate types their name, qualification
            and email into the chat; without this a consultant reads it here and
            retypes it on another page, which is why so many auto-created leads
            stay named after their phone number. */}
        {thread.lead && canAct && (
          <CaptureBar
            leadId={thread.lead.id}
            messages={thread.messages}
            selection={selection}
            currentEmail={thread.lead.email}
            onSaved={() => {
              setSelection("");
              void load();
              onChanged();
            }}
          />
        )}

        <div
          className="flex-1 overflow-auto scrollbar-thin bg-surface-container-low p-md space-y-sm"
          onMouseUp={() => setSelection(window.getSelection()?.toString().trim().slice(0, 200) ?? "")}
        >
          {thread.truncated && (
            <p className="text-label-sm text-on-surface-variant text-center">
              Showing the most recent {thread.messages.length} messages.
            </p>
          )}
          {thread.messages.length === 0 && (
            <p className="text-center text-on-surface-variant py-lg">No messages on this thread yet.</p>
          )}
          {thread.messages.map((m) => (
            <Bubble key={m.id} message={m} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Keyed on the thread so switching conversation REMOUNTS the composer.
            Without this React reuses the instance and a draft typed for one
            candidate stays in the box — and gets sent to the next one opened. */}
        <WaComposer
          key={thread.id}
          conversationId={thread.id}
          sessionOpen={thread.sessionOpen}
          canAct={canAct}
          canSendText={canSendText}
          canSendTemplate={canSendTemplate}
          providerLabel={providerLabel}
          templates={templates}
          onSent={() => {
            void load();
            onChanged();
          }}
        />
      </div>

      <ContextRail
        thread={thread}
        canAct={canAct}
        canAssign={canAssign}
        bdes={bdes}
        masters={masters}
        onChanged={() => {
          void load();
          onChanged();
        }}
      />
    </>
  );
}

function SessionPill({ sessionOpen, sessionExpiresAt }: { sessionOpen: boolean; sessionExpiresAt: string | null }) {
  const left = windowLeft(sessionExpiresAt);
  if (sessionOpen && left) {
    return (
      <span className="shrink-0 inline-flex items-center gap-xs px-sm h-6 rounded-full bg-emerald-500/10 text-emerald-600 text-label-sm font-semibold">
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          schedule
        </span>
        {left}
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-flex items-center gap-xs px-sm h-6 rounded-full bg-surface-container text-on-surface-variant text-label-sm font-semibold">
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
        lock_clock
      </span>
      Template only
    </span>
  );
}

function Bubble({ message }: { message: ThreadMessage }) {
  const outbound = message.direction === "out";
  const status = message.waStatus ? WA_STATUS_GLYPH[message.waStatus] : null;
  const text = message.body?.trim() || (message.type !== "text" ? `[${message.type}]` : "");

  return (
    <div className={"flex " + (outbound ? "justify-end" : "justify-start")}>
      <div
        className={
          "max-w-[78%] rounded-xl px-md py-sm space-y-xs " +
          (outbound ? "bg-primary/10 border border-primary/20" : "bg-surface-container-lowest border border-outline-variant")
        }
      >
        {message.templateName && (
          <span className="block text-label-sm text-on-surface-variant font-mono">{message.templateName}</span>
        )}
        <p className="text-body-md text-on-surface whitespace-pre-wrap break-words">{text}</p>
        {message.fileName && (
          <span className="block text-label-sm text-on-surface-variant">
            {message.fileName}
            {message.mediaMime ? ` · ${message.mediaMime}` : ""}
          </span>
        )}
        <div className="flex items-center justify-end gap-xs text-label-sm text-on-surface-variant">
          {outbound && message.sentByName && <span>{message.sentByName}</span>}
          <span className="tabular-nums">{fmtDateTime(message.occurredAt)}</span>
          {status && (
            <span
              className={"material-symbols-outlined " + status.cls}
              style={{ fontSize: 14 }}
              title={message.waErrorCode ? `${status.label} (${message.waErrorCode})` : status.label}
            >
              {status.icon}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ContextRail({
  thread,
  canAct,
  canAssign,
  bdes,
  masters,
  onChanged,
}: {
  thread: Thread;
  canAct: boolean;
  canAssign: boolean;
  bdes: BdeOpt[];
  masters: InboxMasters;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A rejected PATCH used to be swallowed: the request 403'd, onChanged() ran
  // anyway, the list re-fetched unchanged, and the user saw their selection
  // silently revert with no explanation.
  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/wa/conversations/${thread.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);

    if (!res) {
      setError("Network error — nothing was changed.");
      return;
    }
    if (!res.ok) {
      const d = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(d?.message ?? "You don’t have permission to change this thread.");
      return;
    }
    onChanged();
  }

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md space-y-md overflow-auto scrollbar-thin">
      {thread.lead ? (
        <>
          <div>
            <Link href={`/crm/leads/${thread.lead.id}`} className="text-body-md font-semibold text-primary hover:underline">
              {thread.lead.candidateName}
            </Link>
            <p className="text-label-sm text-on-surface-variant">Open the full lead →</p>
          </div>

          {/* Duplicates first — before anything is typed. A candidate who already
              exists under another number, or whose email only surfaces later in
              the chat, becomes two records silently; found now it is a link,
              found in a report later it is an argument about which row is real. */}
          {thread.duplicates.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-sm space-y-xs">
              <p className="text-label-sm font-semibold text-amber-700">
                {thread.duplicates.length} other lead{thread.duplicates.length === 1 ? "" : "s"} share this identity
              </p>
              {thread.duplicates.slice(0, 3).map((d) => (
                <Link
                  key={d.id}
                  href={`/crm/leads/${d.id}`}
                  className="block text-label-sm text-primary hover:underline truncate"
                >
                  {d.candidateName} · {d.status.label} <span className="text-on-surface-variant">({d.matchedOn})</span>
                </Link>
              ))}
            </div>
          )}

          <LeadFields lead={thread.lead} masters={masters} canEdit={canAct} onSaved={onChanged} />

          <QuickTask leadId={thread.lead.id} canEdit={canAct} />

          {thread.activity.length > 0 && (
            <div className="pt-md border-t border-outline-variant space-y-xs">
              <span className="block text-label-sm text-on-surface-variant">Recent activity</span>
              {thread.activity.map((a) => (
                <p key={a.id} className="text-label-sm text-on-surface-variant">
                  <span className="text-on-surface">{a.summary ?? a.type}</span>
                  {a.actorName ? ` · ${a.actorName}` : ""} · {fmtRelative(a.occurredAt)}
                </p>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-xs">
          <p className="text-body-md font-semibold text-on-surface">No linked lead</p>
          <p className="text-label-sm text-on-surface-variant">
            This number isn’t in the CRM. Messages are still stored against the thread.
          </p>
        </div>
      )}

      <div className="pt-md border-t border-outline-variant space-y-sm">
        {error && <p className="text-label-sm text-error">{error}</p>}
        <div>
          <span className="block text-label-sm text-on-surface-variant mb-xs">Owner</span>
          {canAssign ? (
            <select
              value={thread.assignedTo?.id ?? ""}
              disabled={busy}
              onChange={(e) => void patch({ assignedToId: e.target.value || null })}
              className="w-full h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary outline-none"
            >
              <option value="">Unassigned</option>
              {bdes.map((b) => (
                <option key={b.userId} value={b.userId}>
                  {b.displayName}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-body-md text-on-surface">{thread.assignedTo?.name ?? "Unassigned"}</span>
          )}
        </div>

        {/* Only rendered for someone the server will actually accept — PATCH
            re-checks canActOnConversation and 403s otherwise. */}
        {canAct && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void patch({ status: thread.status === "open" ? "closed" : "open" })}
              className="w-full h-9 rounded-lg border border-outline-variant text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-40"
            >
              {thread.status === "open" ? "Close conversation" : "Reopen conversation"}
            </button>
            <p className="text-label-sm text-on-surface-variant">
              Closing only clears it from the working list — it doesn’t change the lead’s stage.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** First email address appearing in any inbound message. */
function emailInMessages(messages: ThreadMessage[]): string | null {
  for (const m of messages) {
    if (m.direction !== "in" || !m.body) continue;
    const found = m.body.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (found) return found[0];
  }
  return null;
}

/**
 * One-click capture of what the candidate typed.
 *
 * Two routes, because they suit different data. An EMAIL is machine-findable, so
 * it is offered unprompted. A NAME or a place is not — so those come from
 * whatever the consultant highlights, which is faster than any parser and never
 * wrong in a way they cannot see.
 *
 * Nothing is written silently: every action is an explicit button naming the
 * field it will set.
 */
function CaptureBar({
  leadId,
  messages,
  selection,
  currentEmail,
  onSaved,
}: {
  leadId: string;
  messages: ThreadMessage[];
  selection: string;
  currentEmail: string | null;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const detectedEmail = useMemo(() => emailInMessages(messages), [messages]);
  // Only offer it while it would actually change something.
  const offerEmail = detectedEmail && detectedEmail.toLowerCase() !== (currentEmail ?? "").toLowerCase();

  async function set(patch: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onSaved();
  }

  if (!offerEmail && !selection) return null;

  const btn =
    "px-sm h-7 rounded-full text-label-sm font-semibold border border-primary/40 text-primary hover:bg-primary/10 transition disabled:opacity-40";

  return (
    <div className="px-md py-xs border-b border-outline-variant bg-primary/5 flex flex-wrap items-center gap-xs">
      {offerEmail && (
        <button type="button" disabled={busy} className={btn} onClick={() => void set({ email: detectedEmail })}>
          Set email: {detectedEmail}
        </button>
      )}
      {selection && (
        <>
          <span className="text-label-sm text-on-surface-variant truncate max-w-[40%]">“{selection}”</span>
          <button type="button" disabled={busy} className={btn} onClick={() => void set({ candidateName: selection })}>
            Use as name
          </button>
          <button type="button" disabled={busy} className={btn} onClick={() => void set({ country: selection })}>
            Use as country
          </button>
          <button
            type="button"
            disabled={busy}
            className={btn}
            onClick={() => void set({ studyDestination: selection })}
          >
            Use as destination
          </button>
        </>
      )}
    </div>
  );
}

const railInput =
  "w-full h-8 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary outline-none";

/**
 * The lead fields worth editing WHILE reading a message.
 *
 * An inbound thread arrives as a phone number and nothing else, while the
 * candidate types their name, qualification and country into the chat. Without
 * this the consultant reads it here and retypes it on another page — which is
 * why so many auto-created leads stay named after their phone number.
 *
 * Deliberately not the whole lead form. This is what you can answer from the
 * conversation in front of you; anything else belongs behind "Open the full lead".
 */
function LeadFields({
  lead,
  masters,
  canEdit,
  onSaved,
}: {
  lead: NonNullable<Thread["lead"]>;
  masters: InboxMasters;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState(lead.candidateName);
  const [email, setEmail] = useState(lead.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Re-seed when the conversation changes; the component is reused across threads.
  useEffect(() => {
    setName(lead.candidateName);
    setEmail(lead.email ?? "");
    setError(null);
    setSaved(null);
  }, [lead.id, lead.candidateName, lead.email]);

  async function save(patch: Record<string, unknown>, what: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    const res = await fetch(`/api/crm/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const d = res ? ((await res.json().catch(() => null)) as { message?: string } | null) : null;
      setError(d?.message ?? "That didn’t save.");
      return;
    }
    setSaved(`${what} saved`);
    onSaved();
  }

  if (!canEdit) {
    return (
      <dl className="space-y-sm">
        <Row label="Stage" value={lead.statusLabel} color={lead.statusColor} />
        <Row label="Service" value={lead.serviceName} />
        <Row label="Source" value={lead.sourceLabel} />
        <Row label="Qualification" value={lead.qualificationLabel} />
        <Row label="Country" value={lead.country} />
        <Row label="Email" value={lead.email} />
      </dl>
    );
  }

  const pick = (
    label: string,
    value: string | null,
    options: { id: string; label: string }[],
    field: string,
  ) => (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      <select
        value={value ?? ""}
        disabled={busy}
        onChange={(e) => void save({ [field]: e.target.value || null }, label)}
        className={railInput}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-sm">
      {error && <p className="text-label-sm text-error">{error}</p>}
      {saved && <p className="text-label-sm text-primary">{saved}</p>}

      {/* Text fields commit on blur rather than per keystroke — a PATCH per
          character would be a write storm, and Enter alone would miss the very
          common case of clicking straight into the next field. */}
      <label className="block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Name</span>
        <input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== lead.candidateName && void save({ candidateName: name.trim() }, "Name")}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={railInput}
        />
      </label>

      <label className="block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Email</span>
        <input
          value={email}
          disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => email !== (lead.email ?? "") && void save({ email: email.trim() || null }, "Email")}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={railInput}
        />
      </label>

      {pick("Stage", lead.statusId, masters.statuses, "statusId")}
      {pick("Service", lead.serviceId, masters.services, "serviceId")}
      {pick("Source", lead.sourceId, masters.sources, "sourceId")}
      {pick("Qualification", lead.qualificationId, masters.qualifications, "qualificationId")}

      <label className="block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Country</span>
        <select
          value={lead.country ?? ""}
          disabled={busy}
          onChange={(e) => void save({ country: e.target.value || null }, "Country")}
          className={railInput}
        >
          <option value="">—</option>
          {masters.countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Temperature</span>
        <select
          value={lead.temperature ?? ""}
          disabled={busy}
          onChange={(e) => void save({ temperature: e.target.value || null }, "Temperature")}
          className={railInput}
        >
          <option value="">—</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
      </label>
    </div>
  );
}

/**
 * Add a follow-up without leaving the conversation.
 *
 * Due-date presets rather than a date picker: the decision being made here is
 * "chase this tomorrow", not "on the 19th", and a picker turns a two-second
 * thought into a calendar interaction.
 */
function QuickTask({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  // A real date, not a preset. Presets read well in the abstract but a follow-up
  // is usually pinned to something — a results date, a flight, a call already
  // promised — and none of those are "in 3 days". Defaults to tomorrow so the
  // common case is still one keystroke away.
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!canEdit) return null;

  async function add() {
    setBusy(true);
    setNote(null);
    // 09:00 LOCAL on the chosen day. Parsing the bare "YYYY-MM-DD" would be read
    // as UTC midnight, which lands on the previous evening east of Greenwich —
    // a task due "the 19th" would show as the 18th here.
    const [y, m, day] = dueDate.split("-").map(Number);
    const d = new Date(y, (m ?? 1) - 1, day ?? 1, 9, 0, 0, 0);

    const res = await fetch(`/api/crm/leads/${leadId}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: subject.trim(),
        dueAt: Number.isFinite(d.getTime()) ? d.toISOString() : null,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setNote("That didn’t save.");
      return;
    }
    setSubject("");
    setOpen(false);
    setNote("Task added.");
  }

  return (
    <div className="pt-md border-t border-outline-variant space-y-xs">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full h-8 rounded-lg border border-outline-variant text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container-low"
        >
          + Add task
        </button>
      ) : (
        <div className="space-y-xs">
          <input
            autoFocus
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && subject.trim() && !busy && void add()}
            placeholder="What needs doing?"
            className={railInput}
          />
          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">Due date</span>
            <input
              type="date"
              value={dueDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDueDate(e.target.value)}
              className={railInput}
            />
          </label>
          <div className="flex items-center gap-xs">
            <button
              type="button"
              disabled={busy || !subject.trim() || !dueDate}
              onClick={() => void add()}
              className="h-8 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-40"
            >
              {busy ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-8 px-md text-label-sm text-on-surface-variant"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {note && <p className="text-label-sm text-primary">{note}</p>}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string | null; color?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-sm">
      <dt className="text-label-sm text-on-surface-variant shrink-0">{label}</dt>
      <dd className="text-label-sm text-on-surface text-right truncate" style={color ? { color } : undefined}>
        {value || "—"}
      </dd>
    </div>
  );
}
