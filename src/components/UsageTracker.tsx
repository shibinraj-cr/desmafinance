"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  resolvePathUsage,
  creditForTick,
  USAGE_TICK_MS,
  USAGE_FLUSH_MS,
  USAGE_INTERACTION_EVENTS,
  type UsageLocation,
} from "@/lib/usage-tracking";

const ENDPOINT = "/api/telemetry/activity";

/**
 * Invisible engagement heartbeat mounted in the authenticated app shell.
 *
 * It measures *active* time per module/page, not open-tab wall-clock: every
 * USAGE_TICK_MS it credits time to the current page only while the tab is
 * visible AND the user has interacted within the idle window (the rule lives in
 * creditForTick). Accumulated seconds are flushed to the server periodically and
 * on tab-close via sendBeacon, so nothing is lost when the user navigates away.
 *
 * Renders nothing. Only mounted inside (app)/layout, so it never runs on the
 * login screen and always posts as a signed-in user.
 */
export function UsageTracker() {
  const pathname = usePathname();

  // The current module/page, kept in a ref so the tick loop reads the latest
  // value without re-subscribing its interval on every navigation.
  const location = useRef<UsageLocation>({ moduleId: "unknown", page: "/" });
  useEffect(() => {
    location.current = resolvePathUsage(pathname);
  }, [pathname]);

  useEffect(() => {
    let lastInteractionMs = Date.now();
    let lastTickMs = Date.now();
    // Pending active-seconds by `${moduleId} ${page}`; float until flush.
    let pending = new Map<string, number>();

    const now = () => Date.now();

    // --- interaction + visibility signals ---------------------------------
    // Throttle interaction writes: mousemove fires constantly, but we only need
    // to know "did anything happen recently", so one write per second is plenty.
    let lastMark = 0;
    const markInteraction = () => {
      const t = now();
      if (t - lastMark < 1_000) return;
      lastMark = t;
      lastInteractionMs = t;
    };
    for (const ev of USAGE_INTERACTION_EVENTS) {
      window.addEventListener(ev, markInteraction, { passive: true });
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Don't bank the hidden gap; treat the return-to-tab as fresh presence.
        lastTickMs = now();
        lastInteractionMs = now();
      } else {
        // Leaving/backgrounding the tab — get what we have to the server now.
        flush(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // --- the crediting tick ------------------------------------------------
    const tick = () => {
      const t = now();
      const seconds = creditForTick({
        nowMs: t,
        lastTickMs,
        lastInteractionMs,
        visible: document.visibilityState === "visible",
      });
      lastTickMs = t;
      if (seconds > 0) {
        const { moduleId, page } = location.current;
        const key = `${moduleId} ${page}`;
        pending.set(key, (pending.get(key) ?? 0) + seconds);
      }
    };
    const tickId = window.setInterval(tick, USAGE_TICK_MS);

    // --- flushing ----------------------------------------------------------
    function drainItems(): { moduleId: string; page: string; seconds: number }[] {
      if (pending.size === 0) return [];
      const snapshot = pending;
      pending = new Map();
      const items: { moduleId: string; page: string; seconds: number }[] = [];
      for (const [key, secs] of snapshot) {
        const rounded = Math.round(secs);
        if (rounded < 1) continue;
        const sep = key.indexOf(" ");
        items.push({ moduleId: key.slice(0, sep), page: key.slice(sep + 1), seconds: rounded });
      }
      return items;
    }

    function flush(useBeacon = false) {
      const items = drainItems();
      if (items.length === 0) return;
      const body = JSON.stringify({ items });
      try {
        if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
          const blob = new Blob([body], { type: "application/json" });
          const ok = navigator.sendBeacon(ENDPOINT, blob);
          // If the browser refused the beacon, fall back to keepalive fetch.
          if (ok) return;
        }
        void fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Telemetry must never surface to the user.
      }
    }
    const flushId = window.setInterval(() => flush(false), USAGE_FLUSH_MS);

    // pagehide covers real unloads (bfcache-safe); visibilitychange covers most
    // tab switches and mobile app-backgrounding.
    const onPageHide = () => flush(true);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(tickId);
      window.clearInterval(flushId);
      for (const ev of USAGE_INTERACTION_EVENTS) {
        window.removeEventListener(ev, markInteraction);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      // Best-effort final flush of anything the last tick accrued.
      flush(true);
    };
  }, []);

  return null;
}
