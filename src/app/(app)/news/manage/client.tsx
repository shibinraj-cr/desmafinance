"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Section } from "@/components/Cards";
import { TOPIC_COLORS, toneFor } from "../client";
import { isChatGptShareUrl } from "@/lib/news/chatgpt";

export type ManageSource = {
  id: string;
  topicId: string;
  name: string;
  url: string;
  kind: string;
  isActive: boolean;
  lastFetchedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastItemCount: number;
  itemCount: number;
};

export type ManageTopic = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  itemCount: number;
  sourceCount: number;
  sources: ManageSource[];
};

/** Read an error message out of a failed API response, whatever shape it took. */
async function errorFrom(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  if (body && typeof body.error === "string") return body.error;
  return `Request failed (${res.status})`;
}

export function NewsManageClient({ topics }: { topics: ManageTopic[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const refresh = () => start(() => router.refresh());

  async function syncAll() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/news/sync", { method: "POST" });
      if (!res.ok) {
        setNotice({ tone: "error", text: await errorFrom(res) });
        return;
      }
      const data = await res.json();
      setNotice({
        tone: "ok",
        text: `Checked ${data.ran} source${data.ran === 1 ? "" : "s"} · ${data.created} new update${data.created === 1 ? "" : "s"}.`,
      });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-margin">
      <Section
        title="How this works"
        action={
          <button
            type="button"
            onClick={syncAll}
            disabled={busy || topics.length === 0}
            className="inline-flex items-center gap-xs rounded-lg bg-primary text-on-primary px-md py-sm text-label-sm font-semibold disabled:opacity-50"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              sync
            </span>
            {busy ? "Checking…" : "Check all sources now"}
          </button>
        }
      >
        <p className="text-label-sm text-on-surface-variant">
          Each topic holds one or more links. Once a day the system opens every link and files
          anything new under that link&apos;s topic, so everyone sees it on{" "}
          <span className="font-semibold">News &amp; Updates</span> with an unread badge. Use
          &quot;Check now&quot; if you don&apos;t want to wait for the daily run.
        </p>
        {notice && (
          <p
            className={
              "mt-md text-label-sm rounded-lg px-md py-sm " +
              (notice.tone === "ok"
                ? "bg-emerald-50 text-emerald-800"
                : "bg-red-50 text-red-800")
            }
          >
            {notice.text}
          </p>
        )}
      </Section>

      <NewTopicForm onDone={refresh} />

      {topics.length === 0 ? (
        <Section title="Topics">
          <p className="py-lg text-center text-on-surface-variant text-label-sm">
            No topics yet. Add one above — for example &quot;Australia Immigration&quot; — then
            attach the links you want followed.
          </p>
        </Section>
      ) : (
        topics.map((t) => <TopicCard key={t.id} topic={t} topics={topics} onDone={refresh} />)
      )}
    </div>
  );
}

function NewTopicForm({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("newspaper");
  const [color, setColor] = useState("blue");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/news/topics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          icon: icon.trim() || undefined,
          color,
        }),
      });
      if (!res.ok) {
        setError(await errorFrom(res));
        return;
      }
      setName("");
      setDescription("");
      setIcon("newspaper");
      setColor("blue");
      setOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm text-label-sm text-on-surface hover:bg-surface-container transition"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          add
        </span>
        New topic
      </button>
    );
  }

  return (
    <Section title="New topic">
      <form onSubmit={submit} className="space-y-md">
        <div className="grid gap-md md:grid-cols-2">
          <Field label="Name" hint="Shown as the filter chip, e.g. “Australia Immigration”.">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              autoFocus
              className={inputCls}
            />
          </Field>
          <Field label="Description" hint="Optional. Appears as a tooltip on the chip.">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              className={inputCls}
            />
          </Field>
          <Field label="Icon" hint="A Material Symbols name, e.g. flight, gavel, school.">
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={40}
              className={inputCls}
            />
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-xs">
              {TOPIC_COLORS.map((c) => {
                const tone = toneFor(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={c}
                    aria-pressed={color === c}
                    className={
                      "h-8 w-8 rounded-full border-2 transition " +
                      tone.dot +
                      (color === c ? " ring-2 ring-offset-2 ring-primary border-white" : " border-transparent")
                    }
                  />
                );
              })}
            </div>
          </Field>
        </div>

        {error && <p className="text-label-sm text-red-700">{error}</p>}

        <div className="flex items-center gap-sm">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-primary text-on-primary px-md py-sm text-label-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add topic"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-outline-variant px-md py-sm text-label-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </Section>
  );
}

function TopicCard({
  topic,
  topics,
  onDone,
}: {
  topic: ManageTopic;
  topics: ManageTopic[];
  onDone: () => void;
}) {
  const tone = toneFor(topic.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/news/topics/${topic.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) setError(await errorFrom(res));
      else onDone();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete the topic “${topic.name}” and its links?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/news/topics/${topic.id}`, { method: "DELETE" });
      if (!res.ok) setError(await errorFrom(res));
      else onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title=""
      className={topic.isActive ? "" : "opacity-60"}
    >
      <div className="flex flex-wrap items-start justify-between gap-md mb-md">
        <div className="flex items-start gap-sm min-w-0">
          <span className={"grid h-10 w-10 place-items-center rounded-lg border " + tone.chip}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              {topic.icon}
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-h3 text-on-surface font-bold truncate">{topic.name}</p>
            <p className="text-caption text-on-surface-variant">
              {topic.sourceCount} link{topic.sourceCount === 1 ? "" : "s"} · {topic.itemCount} update
              {topic.itemCount === 1 ? "" : "s"} · /news?topic={topic.slug}
              {!topic.isActive && " · hidden"}
            </p>
            {topic.description && (
              <p className="text-label-sm text-on-surface-variant mt-xs">{topic.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-sm flex-shrink-0">
          <label className="inline-flex items-center gap-xs text-label-sm text-on-surface-variant">
            <input
              type="checkbox"
              checked={topic.isActive}
              disabled={busy}
              onChange={(e) => patch({ isActive: e.target.checked })}
            />
            Visible
          </label>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            title={
              topic.itemCount > 0
                ? "Topics with updates can't be deleted — untick Visible to retire it"
                : "Delete this topic"
            }
            className="grid h-8 w-8 place-items-center rounded text-on-surface-variant hover:bg-red-50 hover:text-red-700 disabled:opacity-40 transition"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              delete
            </span>
          </button>
        </div>
      </div>

      {error && <p className="text-label-sm text-red-700 mb-md">{error}</p>}

      <div className="space-y-sm">
        {topic.sources.map((s) => (
          <SourceRow key={s.id} source={s} topics={topics} onDone={onDone} />
        ))}
        <NewSourceForm topicId={topic.id} onDone={onDone} />
      </div>
    </Section>
  );
}

/** Colour + wording for a source's last run. Silence is not the same as success. */
function statusChip(s: ManageSource): { text: string; cls: string } {
  if (!s.lastFetchedAt) return { text: "not checked yet", cls: "bg-surface-container text-on-surface-variant" };
  if (s.lastStatus === "error") return { text: "failing", cls: "bg-red-50 text-red-800" };
  if (s.lastStatus === "empty") return { text: "no entries found", cls: "bg-amber-50 text-amber-900" };
  return { text: "working", cls: "bg-emerald-50 text-emerald-800" };
}

function SourceRow({
  source,
  topics,
  onDone,
}: {
  source: ManageSource;
  topics: ManageTopic[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const chip = statusChip(source);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/news/sources/${source.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) setError(await errorFrom(res));
      else onDone();
    } finally {
      setBusy(false);
    }
  }

  async function fetchNow() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/news/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: source.id }),
      });
      if (!res.ok) {
        setError(await errorFrom(res));
        return;
      }
      const data = await res.json();
      const r = data.results?.[0];
      const count = r?.created ?? 0;
      setResult(
        r?.status === "error"
          ? `Failed: ${r.error}`
          : count === 0 && r?.error
            ? r.error
            : `${count} new update${count === 1 ? "" : "s"}.${r?.error ? ` ${r.error}` : ""}`,
      );
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Stop following “${source.name}”? Updates already published stay in the feed.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/news/sources/${source.id}`, { method: "DELETE" });
      if (!res.ok) setError(await errorFrom(res));
      else onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={
        "border rounded-lg p-md " +
        (source.isActive ? "border-outline-variant bg-surface" : "border-outline-variant bg-surface opacity-60")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-xs">
            <p className="font-semibold text-on-surface truncate">{source.name}</p>
            <span className={"text-[11px] rounded-full px-sm py-[1px] " + chip.cls}>{chip.text}</span>
            <span className="text-[11px] rounded-full px-sm py-[1px] bg-surface-container text-on-surface-variant">
              {source.kind === "page"
                ? "watches the page"
                : source.kind === "chatgpt"
                  ? "shared ChatGPT chat"
                  : "RSS/Atom feed"}
            </span>
          </div>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-label-sm text-blue-700 underline break-all"
          >
            {source.url}
          </a>
          <p className="text-caption text-on-surface-variant mt-xs">
            {source.itemCount} update{source.itemCount === 1 ? "" : "s"} published
            {source.lastFetchedAt
              ? ` · last checked ${new Date(source.lastFetchedAt).toLocaleString()}`
              : ""}
          </p>
          {/* The sync writes guidance, not just a status code, into lastError —
              render it verbatim rather than second-guessing it here. */}
          {source.lastStatus === "error" && source.lastError && (
            <p className="text-label-sm text-red-700 mt-xs">{source.lastError}</p>
          )}
          {source.lastStatus === "empty" && (
            <p className="text-label-sm text-amber-800 mt-xs">
              {source.lastError ?? "Nothing readable at this link."}
            </p>
          )}
          {/* A successful import can still need attention — e.g. a chat holding
              more updates than one import takes. */}
          {source.lastStatus === "ok" && source.lastError && (
            <p className="text-label-sm text-amber-800 mt-xs">{source.lastError}</p>
          )}
          {result && <p className="text-label-sm text-on-surface-variant mt-xs">{result}</p>}
          {error && <p className="text-label-sm text-red-700 mt-xs">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-xs flex-shrink-0">
          <select
            value={source.kind}
            disabled={busy}
            onChange={(e) => patch({ kind: e.target.value })}
            className={inputCls + " h-8 text-label-sm px-sm"}
            aria-label="How this link is read"
          >
            <option value="rss">RSS/Atom feed</option>
            <option value="page">Watch the page</option>
            <option value="chatgpt">Shared ChatGPT chat</option>
          </select>
          <select
            value={source.topicId}
            disabled={busy}
            onChange={(e) => patch({ topicId: e.target.value })}
            className={inputCls + " h-8 text-label-sm px-sm"}
            aria-label="Topic"
          >
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-xs text-label-sm text-on-surface-variant">
            <input
              type="checkbox"
              checked={source.isActive}
              disabled={busy}
              onChange={(e) => patch({ isActive: e.target.checked })}
            />
            On
          </label>
          <button
            type="button"
            onClick={fetchNow}
            disabled={busy}
            title="Check this link now"
            className="grid h-8 w-8 place-items-center rounded text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40 transition"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              sync
            </span>
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            title="Stop following this link"
            className="grid h-8 w-8 place-items-center rounded text-on-surface-variant hover:bg-red-50 hover:text-red-700 disabled:opacity-40 transition"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              delete
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function NewSourceForm({ topicId, onDone }: { topicId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState("rss");
  /** Once the admin picks a mode themselves, stop auto-detecting over them. */
  const [kindTouched, setKindTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/news/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topicId, name: name.trim(), url: url.trim(), kind }),
      });
      if (!res.ok) {
        setError(await errorFrom(res));
        return;
      }
      // The API pulls the new link once before replying, so the admin learns here
      // whether it works rather than finding out from tomorrow's silence.
      const data = await res.json();
      const r = data.result;
      if (r?.status === "error") {
        setError(`Saved, but the link could not be read: ${r.error}`);
      } else if (r?.status === "empty") {
        setError(`Saved, but nothing was published. ${r.error ?? ""}`.trim());
      } else if (r?.error && (r?.created ?? 0) === 0) {
        // A successful pull can still file nothing — e.g. a live feed whose
        // newest entry predates the window. The sync explains which; relay it
        // rather than showing a bare "0 filed" that reads as a failure.
        setResult(`Added · ${r.error}`);
      } else {
        const count = r?.created ?? 0;
        setResult(
          `Added · ${count} update${count === 1 ? "" : "s"} filed.${r?.error ? ` ${r.error}` : ""}`,
        );
      }
      setName("");
      setUrl("");
      setKindTouched(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-xs text-label-sm text-blue-700 hover:underline"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          add_link
        </span>
        Add a link to this topic
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="border border-dashed border-outline-variant rounded-lg p-md space-y-md">
      <div className="grid gap-md md:grid-cols-3">
        <Field label="Label" hint="How it appears under each update.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            autoFocus
            className={inputCls}
          />
        </Field>
        <Field
          label="Link"
          hint="Paste a ChatGPT share link, a site's feed URL, or the page itself."
        >
          <input
            type="url"
            value={url}
            onChange={(e) => {
              const next = e.target.value;
              setUrl(next);
              // A ChatGPT share link is unmistakable and is read a different way
              // from everything else, so pick the mode rather than making the
              // admin know it — and leave a hand-picked mode alone.
              if (!kindTouched && isChatGptShareUrl(next)) setKind("chatgpt");
            }}
            required
            placeholder="https://chatgpt.com/share/…"
            className={inputCls}
          />
        </Field>
        <Field label="How to read it">
          <select
            value={kind}
            onChange={(e) => {
              setKindTouched(true);
              setKind(e.target.value);
            }}
            className={inputCls}
          >
            <option value="chatgpt">Shared ChatGPT chat — one update per point</option>
            <option value="rss">RSS/Atom feed — one update per entry</option>
            <option value="page">Watch the page — post when it changes</option>
          </select>
        </Field>
      </div>

      {error && <p className="text-label-sm text-red-700">{error}</p>}
      {result && <p className="text-label-sm text-emerald-700">{result}</p>}

      <div className="flex items-center gap-sm">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-primary text-on-primary px-md py-sm text-label-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Checking the link…" : "Add link"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-outline-variant px-md py-sm text-label-sm"
        >
          Done
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-label-sm font-semibold text-on-surface mb-xs">{label}</span>
      {children}
      {hint && <span className="block text-caption text-on-surface-variant mt-xs">{hint}</span>}
    </label>
  );
}
