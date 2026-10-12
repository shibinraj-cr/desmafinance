"use client";

// ════════════════════════════════════════════════════════════════════════════
// UncontactedLeadAlarm — the pop-up a BDE gets while any lead assigned to them
// has sat in the New stage for over two hours, and the Marketing Admin gets for
// the whole team's. Mounted by the app layout only for those users (see
// lib/crm-uncontacted-alarm uncontactedAlarmScope), so nobody else pays for it.
//
// Polls /api/crm/uncontacted-leads every minute while the tab is visible and
// re-opens every 20 minutes for as long as anything is on the list. There is no
// way to switch it off: closing it only means "remind me in 20 minutes". The
// only thing that clears it is moving the lead out of New (to Follow Up), which
// the next poll sees.
//
// When it last opened is kept in localStorage, so navigating, reloading or a
// second tab doesn't reset the 20-minute clock. If storage is unavailable it
// falls back to memory and simply asks a little more often.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  UNCONTACTED_AFTER_MINUTES,
  UNCONTACTED_REMIND_EVERY_MINUTES,
  shouldPopUp,
  type UncontactedScope,
  type UncontactedSnapshot,
} from "@/lib/crm-uncontacted-alarm";

const POLL_MS = 60_000;

function since(iso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h ago`;
  return `${hours}h ${mins % 60}m ago`;
}

export function UncontactedLeadAlarm({ userId, scope }: { userId: string; scope: UncontactedScope }) {
  const storageKey = `desgro:uncontacted-alarm:last-shown:${userId}`;
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<UncontactedSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const openRef = useRef(false);
  const memoryLastShown = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const firstButton = useRef<HTMLButtonElement | null>(null);

  const readLastShown = useCallback((): number | null => {
    try {
      const v = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(v) && v > 0) return v;
    } catch {
      /* storage blocked — fall through to memory */
    }
    return memoryLastShown.current;
  }, [storageKey]);

  const writeLastShown = useCallback(
    (t: number) => {
      memoryLastShown.current = t;
      try {
        window.localStorage.setItem(storageKey, String(t));
      } catch {
        /* memory copy is enough */
      }
    },
    [storageKey],
  );

  const show = useCallback((value: boolean) => {
    openRef.current = value;
    setOpen(value);
  }, []);

  // Browsers only allow sound after the user has interacted with the page, so
  // the audio context is created on the first click/keypress, not on mount.
  useEffect(() => {
    const unlock = () => {
      if (audio.current) return;
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) audio.current = new Ctx();
      } catch {
        /* no sound, the pop-up still shows */
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      void audio.current?.close().catch(() => {});
    };
  }, []);

  const chime = useCallback(() => {
    const ctx = audio.current;
    if (!ctx) return;
    try {
      void ctx.resume();
      const tone = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = ctx.currentTime + start;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
      };
      tone(880, 0, 0.25);
      tone(660, 0.3, 0.35);
    } catch {
      /* sound is a nicety */
    }
  }, []);

  const poll = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/crm/uncontacted-leads", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as UncontactedSnapshot | { scope: null };
      const t = Date.now();
      setNow(t);
      if (!data.scope) {
        show(false);
        return;
      }
      setSnap(data);
      if (data.total === 0) {
        // Everything moved on — nothing left to nag about.
        show(false);
        return;
      }
      if (!openRef.current && shouldPopUp({ now: t, lastShownAt: readLastShown(), overdueCount: data.total })) {
        writeLastShown(t);
        show(true);
        chime();
      }
    } catch {
      /* offline or a deploy in progress — try again next tick */
    }
  }, [chime, readLastShown, show, writeLastShown]);

  useEffect(() => {
    setMounted(true);
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  // "Remind me later" — the 20 minutes count from when it was put away.
  const dismiss = useCallback(() => {
    writeLastShown(Date.now());
    show(false);
  }, [show, writeLastShown]);

  useEffect(() => {
    if (!open) return;
    firstButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!mounted || !open || !snap || snap.total === 0) return null;

  const team = scope === "team";
  const hours = UNCONTACTED_AFTER_MINUTES / 60;
  const listHref = snap.newStatusId
    ? `/crm/leads?assignee=${team ? "all" : userId}&status=${snap.newStatusId}`
    : "/crm/leads";
  const more = snap.total - snap.leads.length;

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-md">
      <div className="absolute inset-0 bg-black/50" onClick={dismiss} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="uncontacted-alarm-title"
        aria-describedby="uncontacted-alarm-desc"
        className="relative w-full max-w-[560px] max-h-[85vh] flex flex-col bg-surface-container-lowest border-2 border-error rounded-xl shadow-xl"
      >
        <div className="flex items-start gap-md px-lg py-md border-b border-outline-variant bg-error-container rounded-t-xl">
          <span className="material-symbols-outlined text-on-error-container mt-xs">alarm</span>
          <div className="min-w-0 flex-1">
            <h3 id="uncontacted-alarm-title" className="text-h3 text-on-error-container">
              {team
                ? `${snap.total} ${snap.total === 1 ? "lead" : "leads"} not contacted by the team`
                : `${snap.total} ${snap.total === 1 ? "lead" : "leads"} not contacted yet`}
            </h3>
            <p id="uncontacted-alarm-desc" className="text-body-md text-on-error-container">
              {team
                ? `Assigned over ${hours} hours ago and still in New. Chase the BDE or reassign.`
                : `Assigned to you over ${hours} hours ago and still in New. Call or WhatsApp each one, then move the stage to Follow Up.`}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={`Close — remind me in ${UNCONTACTED_REMIND_EVERY_MINUTES} minutes`}
            className="h-9 w-9 grid place-items-center rounded-lg hover:bg-black/5 text-on-error-container"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto divide-y divide-outline-variant px-lg">
          {snap.leads.map((lead) => (
            <li key={lead.id} className="py-sm flex items-center gap-md">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/crm/leads/${lead.id}`}
                  onClick={dismiss}
                  className="text-body-md font-semibold text-accent hover:underline break-words"
                >
                  {lead.candidateName}
                </Link>
                <p className="text-caption text-on-surface-variant">
                  <span className="text-error font-semibold">Assigned {since(lead.assignedAt, now)}</span>
                  {team && lead.assigneeName ? ` · ${lead.assigneeName}` : ""}
                  {lead.source ? ` · ${lead.source}` : ""}
                </p>
              </div>
              {lead.phone ? (
                <a
                  href={`tel:${lead.phone}`}
                  className="shrink-0 h-9 px-md rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low inline-flex items-center gap-xs font-mono tabular-nums text-body-md"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    call
                  </span>
                  {lead.phone}
                </a>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-sm px-lg py-md border-t border-outline-variant">
          <Link href={listHref} onClick={dismiss} className="text-body-md text-accent hover:underline">
            {more > 0 ? `+${more} more — open the full list` : "Open in the leads list"}
          </Link>
          <button
            ref={firstButton}
            type="button"
            onClick={dismiss}
            className="h-9 px-md rounded-lg bg-primary text-on-primary font-semibold"
          >
            Remind me in {UNCONTACTED_REMIND_EVERY_MINUTES} min
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
