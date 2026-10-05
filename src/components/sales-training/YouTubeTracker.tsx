"use client";

import { useEffect, useRef } from "react";

// Minimal slice of the YouTube IFrame Player API we use.
type YTPlayer = {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: { onStateChange?: (e: { data: number }) => void };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;
const ENDED = 0;
const PAUSED = 2;
/** A 1s sample gap up to this long is continuous playback (covers 2× speed); anything else is a seek. */
const MAX_STEP_SEC = 2.5;
const FLUSH_EVERY_MS = 10_000;

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT!);
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

/**
 * Embedded YouTube player that reports which seconds actually played. Samples
 * the playhead once a second; contiguous samples extend a range, a jump starts
 * a new one — so scrubbing to the end earns only the seconds watched there.
 * Ranges are flushed to the server every 10s and on pause/end/leave.
 */
export function YouTubeTracker({
  videoId,
  youtubeId,
  watchUrl,
  onProgress,
}: {
  /** Our id for the video within the module (not the YouTube id). */
  videoId: string;
  youtubeId: string;
  /** POST endpoint for { videoId, durationSec, ranges }. */
  watchUrl: string;
  onProgress: (pct: number, completed: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const progressCb = useRef(onProgress);
  progressCb.current = onProgress;

  useEffect(() => {
    let player: YTPlayer | null = null;
    let cancelled = false;
    let pending: [number, number][] = [];
    let current: [number, number] | null = null;
    let lastT: number | null = null;

    const takeRanges = () => {
      const out = [...pending, ...(current && current[1] > current[0] ? [[...current] as [number, number]] : [])];
      pending = [];
      if (current) current = [current[1], current[1]];
      return out;
    };

    const flush = (keepalive = false) => {
      if (!player) return;
      const duration = player.getDuration();
      const ranges = takeRanges();
      if (!duration || ranges.length === 0) return;
      fetch(watchUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId, durationSec: duration, ranges }),
        keepalive,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j && !cancelled) progressCb.current(j.watchedPct, j.completed);
        })
        .catch(() => {
          // Network blip: put the ranges back for the next flush.
          pending.push(...ranges);
        });
    };

    const sample = () => {
      if (!player || player.getPlayerState() !== PLAYING) {
        lastT = null;
        if (current) {
          pending.push(current);
          current = null;
        }
        return;
      }
      const t = player.getCurrentTime();
      if (lastT != null && t >= lastT && t - lastT <= MAX_STEP_SEC && current) {
        current[1] = t;
      } else {
        if (current) pending.push(current);
        current = [t, t];
      }
      lastT = t;
    };

    loadYouTubeApi().then((YT) => {
      if (cancelled || !host.current) return;
      const el = document.createElement("div");
      host.current.appendChild(el);
      player = new YT.Player(el, {
        videoId: youtubeId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onStateChange: (e) => {
            if (e.data === PAUSED || e.data === ENDED) {
              sample();
              flush();
            }
          },
        },
      });
    });

    const tick = setInterval(sample, 1000);
    const flusher = setInterval(() => flush(), FLUSH_EVERY_MS);
    const onHide = () => document.visibilityState === "hidden" && flush(true);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      cancelled = true;
      clearInterval(tick);
      clearInterval(flusher);
      document.removeEventListener("visibilitychange", onHide);
      sample();
      flush(true);
      player?.destroy();
    };
  }, [videoId, youtubeId, watchUrl]);

  return <div ref={host} className="aspect-video w-full rounded overflow-hidden bg-black [&>*]:w-full [&>*]:h-full" />;
}
