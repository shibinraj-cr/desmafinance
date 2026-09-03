"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live unanswered-thread count for the sidebar's WhatsApp badge.
 *
 * "Live" here means a short poll from a visible tab, not a push. The app runs on
 * serverless functions with no socket to hold open, so this is honest about what
 * it is: it refreshes every 20 seconds while you are looking at the tab, and
 * stops entirely when you are not — a backgrounded tab polling all day is just a
 * database bill.
 *
 * This used to feed a thread-list panel above the user footer. It now feeds a
 * number on the WhatsApp nav item instead: the count is the signal, and the
 * inbox is one click away, so a second inbox in the rail only cost vertical
 * space the nav needed.
 */

const POLL_MS = 20_000;

export type WaLiveCounts = {
  /** Threads waiting on a reply from us — the number worth acting on. */
  waiting: number;
  /** All open threads, for the badge's tooltip. */
  count: number;
};

type LivePayload = {
  enabled: boolean;
  reason?: string;
  count: number;
  waiting: number;
};

export function useWaLiveCount(enabled: boolean): WaLiveCounts | null {
  const [data, setData] = useState<WaLiveCounts | null>(null);
  // Once the server says the mirror is off, there is no point asking again this
  // session — the answer cannot change without a settings save and a reload.
  const stopped = useRef(false);

  const load = useCallback(async () => {
    if (stopped.current) return;
    const res = await fetch("/api/crm/wa/live").catch(() => null);
    if (!res?.ok) return;
    const payload = (await res.json().catch(() => null)) as LivePayload | null;
    if (!payload) return;
    if (!payload.enabled) {
      stopped.current = true;
      setData(null);
      return;
    }
    setData({ waiting: payload.waiting ?? 0, count: payload.count ?? 0 });
  }, []);

  useEffect(() => {
    if (!enabled) return;

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
  }, [enabled, load]);

  return data;
}
