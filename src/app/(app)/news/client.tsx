"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Section } from "@/components/Cards";
import type { FeedItem } from "@/lib/news/read";

export type TopicChip = {
  id: string;
  slug: string;
  name: string;
  icon: string;
  color: string;
  description: string | null;
  unread: number;
};

/**
 * Topic accents. Topics are admin-created, so the colour has to come from a
 * fixed set rather than arbitrary CSS: a free-text class name would be stripped
 * by Tailwind's build-time scan and render as no colour at all.
 */
const TOPIC_TONE: Record<string, { chip: string; dot: string; ring: string }> = {
  blue: { chip: "bg-blue-50 text-blue-800 border-blue-200", dot: "bg-blue-500", ring: "border-blue-400" },
  green: { chip: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500", ring: "border-emerald-400" },
  amber: { chip: "bg-amber-50 text-amber-900 border-amber-200", dot: "bg-amber-500", ring: "border-amber-400" },
  red: { chip: "bg-red-50 text-red-800 border-red-200", dot: "bg-red-500", ring: "border-red-400" },
  violet: { chip: "bg-violet-50 text-violet-800 border-violet-200", dot: "bg-violet-500", ring: "border-violet-400" },
  teal: { chip: "bg-teal-50 text-teal-800 border-teal-200", dot: "bg-teal-500", ring: "border-teal-400" },
  slate: { chip: "bg-slate-100 text-slate-800 border-slate-300", dot: "bg-slate-500", ring: "border-slate-400" },
};

export const TOPIC_COLORS = Object.keys(TOPIC_TONE);

export function toneFor(color: string) {
  return TOPIC_TONE[color] ?? TOPIC_TONE.blue;
}

/** "2 hours ago" for anything recent; a plain date once that stops being useful. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function NewsFeedClient({
  items,
  topics,
  activeSlug,
  unreadOnly,
  totalUnread,
  isAdmin,
  hasTopics,
}: {
  items: FeedItem[];
  topics: TopicChip[];
  activeSlug: string | null;
  unreadOnly: boolean;
  totalUnread: number;
  isAdmin: boolean;
  hasTopics: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Read state is echoed locally so a row stops looking unread the instant it is
  // clicked, without waiting for the server round trip and refresh.
  const [readNow, setReadNow] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function href(next: { topic?: string | null; unread?: boolean }) {
    const params = new URLSearchParams();
    const topic = next.topic === undefined ? activeSlug : next.topic;
    const un = next.unread === undefined ? unreadOnly : next.unread;
    if (topic) params.set("topic", topic);
    if (un) params.set("unread", "1");
    const qs = params.toString();
    return qs ? `/news?${qs}` : "/news";
  }

  async function markRead(id: string) {
    if (readNow.has(id)) return;
    setReadNow((prev) => new Set(prev).add(id));
    await fetch(`/api/news/items/${id}/read`, { method: "POST" }).catch(() => {});
    // Refresh so the header badge drops too — it is rendered by the layout.
    start(() => router.refresh());
  }

  async function markAllRead() {
    setBusy(true);
    try {
      await fetch("/api/news/read-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: activeSlug }),
      });
      setReadNow(new Set(items.map((i) => i.id)));
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const shownUnread = items.filter((i) => !i.isRead && !readNow.has(i.id)).length;

  return (
    <div className="space-y-margin">
      {/* Topic filter. The unread dot on a chip is what makes the feed
          topic-wise in practice: it says which subject has something new. */}
      <div className="flex flex-wrap items-center gap-sm">
        <Link
          href={href({ topic: null })}
          scroll={false}
          className={
            "inline-flex items-center gap-xs rounded-full border px-md py-xs text-label-sm transition " +
            (activeSlug === null
              ? "bg-primary text-on-primary border-primary font-semibold"
              : "bg-surface border-outline-variant text-on-surface-variant hover:text-on-surface")
          }
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            inbox
          </span>
          All
          {totalUnread > 0 && (
            <span className="ml-xs rounded-full bg-red-500 text-white text-[10px] font-bold tabular-nums px-[6px]">
              {totalUnread}
            </span>
          )}
        </Link>

        {topics.map((t) => {
          const tone = toneFor(t.color);
          const active = activeSlug === t.slug;
          return (
            <Link
              key={t.id}
              href={href({ topic: t.slug })}
              scroll={false}
              title={t.description ?? undefined}
              className={
                "inline-flex items-center gap-xs rounded-full border px-md py-xs text-label-sm transition " +
                (active ? `${tone.chip} font-semibold ${tone.ring}` : "bg-surface border-outline-variant text-on-surface-variant hover:text-on-surface")
              }
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                {t.icon}
              </span>
              {t.name}
              {t.unread > 0 && (
                <span className="ml-xs rounded-full bg-red-500 text-white text-[10px] font-bold tabular-nums px-[6px]">
                  {t.unread}
                </span>
              )}
            </Link>
          );
        })}

        <div className="ml-auto flex items-center gap-sm">
          <Link
            href={href({ unread: !unreadOnly })}
            scroll={false}
            className={
              "inline-flex items-center gap-xs rounded-full border px-md py-xs text-label-sm transition " +
              (unreadOnly
                ? "bg-surface-container-high border-outline text-on-surface font-semibold"
                : "bg-surface border-outline-variant text-on-surface-variant hover:text-on-surface")
            }
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {unreadOnly ? "filter_alt" : "filter_alt_off"}
            </span>
            Unread only
          </Link>
          {shownUnread > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              disabled={busy || pending}
              className="inline-flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs text-label-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50 transition"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                done_all
              </span>
              Mark {activeSlug ? "this topic" : "all"} read
            </button>
          )}
        </div>
      </div>

      <Section title="">
        {items.length === 0 ? (
          <EmptyState hasTopics={hasTopics} unreadOnly={unreadOnly} isAdmin={isAdmin} />
        ) : (
          <ul className="space-y-sm">
            {items.map((n) => {
              const read = n.isRead || readNow.has(n.id);
              const tone = toneFor(n.topicColor);
              return (
                <li
                  key={n.id}
                  className={
                    "relative border rounded-lg p-md transition " +
                    (read ? "border-outline-variant bg-surface" : "border-primary bg-yellow-50/30")
                  }
                >
                  {!read && (
                    <span
                      aria-hidden
                      className="absolute left-[-5px] top-md h-2.5 w-2.5 rounded-full bg-red-500"
                    />
                  )}
                  <div className="flex items-start justify-between gap-sm">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-xs mb-xs">
                        <Link
                          href={href({ topic: n.topicSlug })}
                          scroll={false}
                          className={"inline-flex items-center gap-xs rounded-full border px-sm py-[1px] text-[11px] " + tone.chip}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                            {n.topicIcon}
                          </span>
                          {n.topicName}
                        </Link>
                        {n.isPinned && (
                          <span className="inline-flex items-center gap-xs text-[11px] text-amber-700">
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                              push_pin
                            </span>
                            Pinned
                          </span>
                        )}
                      </div>

                      <p className={"text-body-md " + (read ? "font-semibold" : "font-bold")}>{n.title}</p>

                      {n.summary && (
                        <p className="text-on-surface-variant text-label-sm mt-xs whitespace-pre-wrap">
                          {n.summary}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-sm mt-sm">
                        {n.url && (
                          <a
                            href={n.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            onClick={() => markRead(n.id)}
                            className="text-blue-700 underline text-label-sm"
                          >
                            Read the full update ↗
                          </a>
                        )}
                        <span
                          className="text-caption text-on-surface-variant"
                          title={new Date(n.publishedAt).toLocaleString()}
                        >
                          {relativeTime(n.publishedAt)}
                          {n.sourceName ? ` · ${n.sourceName}` : ""}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-xs flex-shrink-0">
                      {!read && (
                        <button
                          type="button"
                          onClick={() => markRead(n.id)}
                          className="text-blue-700 underline text-label-sm"
                        >
                          Mark read
                        </button>
                      )}
                      {isAdmin && <AdminItemControls item={n} onDone={() => start(() => router.refresh())} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** What to show when the feed has nothing — different advice per reason. */
function EmptyState({
  hasTopics,
  unreadOnly,
  isAdmin,
}: {
  hasTopics: boolean;
  unreadOnly: boolean;
  isAdmin: boolean;
}) {
  if (!hasTopics) {
    return (
      <div className="py-xl text-center">
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 40 }}>
          newspaper
        </span>
        <p className="text-body-md text-on-surface mt-sm font-semibold">No topics yet</p>
        <p className="text-label-sm text-on-surface-variant mt-xs">
          {isAdmin
            ? "Add a topic and a link to follow, and updates will start arriving here every day."
            : "Updates will appear here once an administrator sets them up."}
        </p>
        {isAdmin && (
          <Link
            href="/news/manage"
            className="inline-flex items-center gap-xs mt-md rounded-lg bg-primary text-on-primary px-md py-sm text-label-sm font-semibold"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              rss_feed
            </span>
            Set up topics & sources
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="py-xl text-center">
      <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 40 }}>
        {unreadOnly ? "done_all" : "inbox"}
      </span>
      <p className="text-body-md text-on-surface mt-sm font-semibold">
        {unreadOnly ? "You're all caught up" : "Nothing here yet"}
      </p>
      <p className="text-label-sm text-on-surface-variant mt-xs">
        {unreadOnly
          ? "Every update in this view has been read."
          : "New updates land here automatically once a day."}
      </p>
    </div>
  );
}

/** Pin and remove, shown only to admins, inline on each item. */
function AdminItemControls({ item, onDone }: { item: FeedItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function pin(next: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/news/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isPinned: next }),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove "${item.title}" from the feed for everyone?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/news/items/${item.id}`, { method: "DELETE" });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-xs">
      <button
        type="button"
        onClick={() => pin(!item.isPinned)}
        disabled={busy}
        title={item.isPinned ? "Unpin" : "Pin to the top"}
        aria-label={item.isPinned ? "Unpin this update" : "Pin this update"}
        className="grid h-7 w-7 place-items-center rounded text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40 transition"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          {item.isPinned ? "keep_off" : "push_pin"}
        </span>
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        title="Remove from the feed"
        aria-label="Remove this update"
        className="grid h-7 w-7 place-items-center rounded text-on-surface-variant hover:bg-red-50 hover:text-red-700 disabled:opacity-40 transition"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          delete
        </span>
      </button>
    </div>
  );
}
