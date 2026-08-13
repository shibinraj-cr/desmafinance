"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

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
    statusLabel: string | null;
    statusColor: string | null;
    serviceName: string | null;
    sourceLabel: string | null;
    temperature: string | null;
  } | null;
  assignedTo: { id: string; name: string } | null;
  messages: ThreadMessage[];
  truncated: boolean;
};

type TemplateOpt = { id: string; name: string; body: string };
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
  mirrorEnabled,
  providerLabel,
  canSendText,
  canSendTemplate,
  canAssign,
  templates,
  bdes,
}: {
  mirrorEnabled: boolean;
  providerLabel: string;
  canSendText: boolean;
  canSendTemplate: boolean;
  canAssign: boolean;
  templates: TemplateOpt[];
  bdes: BdeOpt[];
}) {
  const [filter, setFilter] = useState("needs_reply");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [counts, setCounts] = useState({ needsReply: 0, unread: 0, unassigned: 0 });
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  onChanged,
}: {
  conversationId: string | null;
  providerLabel: string;
  canSendText: boolean;
  canSendTemplate: boolean;
  canAssign: boolean;
  templates: TemplateOpt[];
  bdes: BdeOpt[];
  onChanged: () => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [canAct, setCanAct] = useState(false);
  const [loading, setLoading] = useState(false);
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

        <div className="flex-1 overflow-auto scrollbar-thin bg-surface-container-low p-md space-y-sm">
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
        <Composer
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

/**
 * The composer enforces WhatsApp's rule in the UI: free text inside the 24-hour
 * window, an approved template outside it. The server re-checks — a tab left
 * open across the expiry is exactly the case the client gets wrong — but showing
 * the right control up front beats rejecting a message someone already typed.
 */
function Composer({
  conversationId,
  sessionOpen,
  canAct,
  canSendText,
  canSendTemplate,
  providerLabel,
  templates,
  onSent,
}: {
  conversationId: string;
  sessionOpen: boolean;
  canAct: boolean;
  canSendText: boolean;
  canSendTemplate: boolean;
  providerLabel: string;
  templates: TemplateOpt[];
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A template is legal BOTH inside and outside the window; only free text is
  // restricted. So the window narrows the choice rather than dictating it —
  // treating the two as mutually exclusive would hide the template picker during
  // an open session, which on a transport that cannot do free text leaves no way
  // to reply at all. Outside the window, template is simply the only option left.
  const [mode, setMode] = useState<"text" | "template">(sessionOpen && canSendText ? "text" : "template");
  const effectiveMode = sessionOpen ? mode : "template";
  const canChoose = sessionOpen && canSendText && canSendTemplate;
  const capable = effectiveMode === "text" ? canSendText : canSendTemplate;
  const selected = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);

  async function send() {
    setError(null);
    setSending(true);
    // Exactly one of the two — the server rejects a request carrying both,
    // because only one would actually be delivered.
    const payload = effectiveMode === "text" ? { body: text } : { template: selected?.name };
    const res = await fetch(`/api/crm/wa/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setSending(false);

    if (!res) {
      setError("Network error — the message was not sent.");
      return;
    }
    if (!res.ok) {
      const d = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(d?.message ?? "The message could not be sent.");
      return;
    }
    setText("");
    setTemplateId("");
    onSent();
  }

  if (!canAct) {
    return (
      <div className="px-md py-sm border-t border-outline-variant text-label-sm text-on-surface-variant">
        Read-only — only the assigned consultant or an admin can reply on this thread.
      </div>
    );
  }

  if (!capable) {
    // Neither mode works on this transport. Say so once, plainly, rather than
    // showing a control whose every use fails.
    return (
      <div className="px-md py-sm border-t border-outline-variant text-label-sm text-on-surface-variant">
        {canSendText || canSendTemplate
          ? effectiveMode === "text"
            ? `${providerLabel} can’t send free text — choose a template instead.`
            : `${providerLabel} can’t send templates from the inbox.`
          : `${providerLabel} can’t send from the CRM, so replies still happen in Wabis. This starts working when the number moves to the Cloud API.`}
      </div>
    );
  }

  return (
    <div className="px-md py-sm border-t border-outline-variant space-y-xs">
      {error && <p className="text-label-sm text-error">{error}</p>}
      {canChoose && (
        <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
          {(["text", "template"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                "px-md h-7 text-label-sm font-semibold transition " +
                (mode === m
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {m === "text" ? "Reply" : "Template"}
            </button>
          ))}
        </div>
      )}
      {effectiveMode === "text" ? (
        <div className="flex items-end gap-sm">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (text.trim() && !sending) void send();
              }
            }}
            rows={2}
            placeholder="Type a reply… (Enter to send, Shift+Enter for a new line)"
            className="flex-1 px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md resize-none focus:border-primary outline-none"
          />
          <button
            type="button"
            disabled={!text.trim() || sending}
            onClick={() => void send()}
            className="h-10 px-lg rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      ) : (
        <div className="space-y-xs">
          <p className="text-label-sm text-on-surface-variant">
            The 24-hour reply window has closed — only an approved template can be sent.
          </p>
          <div className="flex items-center gap-sm">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="flex-1 h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary outline-none"
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selected || sending}
              onClick={() => void send()}
              className="h-9 px-lg rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-40"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          {selected && (
            <p className="text-label-sm text-on-surface-variant whitespace-pre-wrap border border-outline-variant rounded-lg p-sm bg-surface-container-low">
              {selected.body}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ContextRail({
  thread,
  canAct,
  canAssign,
  bdes,
  onChanged,
}: {
  thread: Thread;
  canAct: boolean;
  canAssign: boolean;
  bdes: BdeOpt[];
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
          <dl className="space-y-sm">
            <Row label="Stage" value={thread.lead.statusLabel} color={thread.lead.statusColor} />
            <Row label="Service" value={thread.lead.serviceName} />
            <Row label="Source" value={thread.lead.sourceLabel} />
            <Row label="Temperature" value={thread.lead.temperature} />
            <Row label="Email" value={thread.lead.email} />
          </dl>
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
