"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Sidebar ticker for candidates waiting on a reply.
 *
 * "Live" here means a short poll from a visible tab, not a push. The app runs on
 * serverless functions with no socket to hold open, so this is honest about what
 * it is: it refreshes every 20 seconds while you are looking at the tab, and
 * stops entirely when you are not — a backgrounded tab polling all day is just a
 * database bill.
 *
 * It renders NOTHING at all unless there is something to say. An empty box that
 * permanently reads "0 waiting" trains people to ignore the corner of the screen
 * where the actual signal will appear.
 */

const POLL_MS = 20_000;

type LiveConversation = {
  id: string;
  name: string;
  leadId: string | null;
  unreadCount: number;
  awaitingReply: boolean;
  lastMessageAt: string | null;
  assignedToName: string | null;
  preview: string | null;
  previewDirection: string | null;
};

type LivePayload = {
  enabled: boolean;
  reason?: string;
  /** All open threads. */
  count: number;
  /** Of those, how many are waiting on us — the number worth acting on. */
  waiting: number;
  conversations: LiveConversation[];
};

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export function WhatsAppLiveBox() {
  const [data, setData] = useState<LivePayload | null>(null);
  // Once the server says the mirror is off, there is no point asking again this
  // session — the answer cannot change without a settings save and a reload.
  const stopped = useRef(false);

  const load = useCallback(async () => {
    if (stopped.current) return;
    const res = await fetch("/api/crm/wa/live").catch(() => null);
    if (!res?.ok) return;
    const payload = (await res.json().catch(() => null)) as LivePayload | null;
    if (!payload) return;
    if (!payload.enabled) stopped.current = true;
    setData(payload);
  }, []);

  useEffect(() => {
    void load();

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer || stopped.current) return;
      timer = setInterval(() => void load(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Refresh immediately on return — the interval alone would leave a stale
        // count on screen for up to a full period.
        void load();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  // Hidden only when there is genuinely nothing — a live list of an empty desk
  // is just a permanent zero in the corner of the screen.
  if (!data?.enabled || data.count === 0) return null;

  return (
    <div className="rounded-lg border border-brand-line bg-brand-elevated overflow-hidden shrink-0 flex flex-col max-h-[46vh]">
      <Link
        href={data.waiting > 0 ? "/crm/inbox?filter=needs_reply" : "/crm/inbox"}
        className="flex items-center gap-xs px-sm h-8 border-b border-brand-line hover:bg-white/5 transition shrink-0"
      >
        <span className="material-symbols-outlined text-emerald-400" style={{ fontSize: 16 }} aria-hidden="true">
          forum
        </span>
        <span className="text-label-sm font-semibold text-on-brand flex-1">WhatsApp</span>
        {/* The badge counts what needs answering, not what exists — a total is
            decoration, an unanswered count is a queue. */}
        {data.waiting > 0 && (
          <span
            className="inline-grid place-items-center min-w-[18px] h-[18px] px-[5px] rounded-full text-[10px] font-bold bg-emerald-500 text-white tabular-nums"
            title={`${data.waiting} waiting on a reply`}
          >
            {data.waiting}
          </span>
        )}
      </Link>

      <ul className="divide-y divide-brand-line overflow-y-auto scrollbar-thin">
        {data.conversations.map((c) => (
          <li key={c.id}>
            <Link
              href={`/crm/inbox?conversation=${c.id}`}
              className="block px-sm py-xs hover:bg-white/5 transition"
              title={c.preview ?? undefined}
            >
              <div className="flex items-baseline gap-xs">
                {/* One dot carries "they are waiting on us" without a second badge. */}
                {c.awaitingReply && (
                  <span className="w-[6px] h-[6px] rounded-full bg-emerald-400 shrink-0" aria-label="waiting on reply" />
                )}
                <span className="text-label-sm font-semibold text-on-brand truncate flex-1">{c.name}</span>
                <span className="text-[10px] text-on-brand/60 tabular-nums shrink-0">{ago(c.lastMessageAt)}</span>
              </div>
              {c.preview && (
                <p className="text-[11px] text-on-brand/70 truncate">
                  {c.previewDirection === "out" && <span className="text-on-brand/50">You: </span>}
                  {c.preview}
                </p>
              )}
              <p className="text-[10px] text-on-brand/50 truncate">
                {c.assignedToName ?? "Unassigned"}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {data.count > data.conversations.length && (
        <Link
          href="/crm/inbox"
          className="block px-sm py-xs text-[11px] text-on-brand/70 hover:bg-white/5 transition border-t border-brand-line shrink-0"
        >
          +{data.count - data.conversations.length} more…
        </Link>
      )}
    </div>
  );
}
