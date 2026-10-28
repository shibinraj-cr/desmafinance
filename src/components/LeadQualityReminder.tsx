"use client";

// ════════════════════════════════════════════════════════════════════════════
// LeadQualityReminder — the pop-up a BDE gets while any lead assigned to them
// has gone past its quality-rating due date (five days after it entered the
// system) without being rated. Mounted by the app layout for active BDEs only.
//
// Each lead can be rated right here: pick Good / Average / Poor / Junk, and a
// reason for the last two. Rated rows drop off the list. Closing it only means
// "remind me in 30 minutes"; the only thing that clears it is rating the
// leads. Same cadence mechanics as UncontactedLeadAlarm: polls while the tab is
// visible, and the last-shown time lives in localStorage so navigating or a
// second tab doesn't reset the clock.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QualityDot, qualityChipStyle } from "@/components/crm/LeadQualityPicker";
import {
  LEAD_QUALITIES,
  QUALITY_DUE_AFTER_DAYS,
  QUALITY_REMIND_EVERY_MINUTES,
  qualityNeedsReason,
  shouldRemindQuality,
  type LeadQualityRating,
  type QualityReminderLead,
  type QualityReminderSnapshot,
} from "@/lib/crm-lead-quality";
import { subscribeAttention } from "./crm-attention-feed";


function overdueBy(iso: string, now: number): string {
  const days = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
  return days === 0 ? "overdue" : `${days}d overdue`;
}

export function LeadQualityReminder({ userId }: { userId: string }) {
  const storageKey = `desgro:lead-quality-reminder:last-shown:${userId}`;
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<QualityReminderSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const openRef = useRef(false);
  const memoryLastShown = useRef<number | null>(null);

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

  const onData = useCallback(
    (raw: unknown) => {
      const data = raw as QualityReminderSnapshot;
      const t = Date.now();
      setNow(t);
      setSnap(data);
      if (data.total === 0) {
        show(false);
        return;
      }
      if (!openRef.current && shouldRemindQuality({ now: t, lastShownAt: readLastShown(), overdueCount: data.total })) {
        writeLastShown(t);
        show(true);
      }
    },
    [readLastShown, show, writeLastShown],
  );

  // The data arrives on the shared CRM attention poll (crm-attention-feed).
  useEffect(() => {
    setMounted(true);
    return subscribeAttention("quality", onData);
  }, [onData]);

  const dismiss = useCallback(() => {
    writeLastShown(Date.now());
    show(false);
  }, [show, writeLastShown]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  // A rated row leaves the list at once; the total follows, and an empty list
  // closes the pop-up. The page behind refreshes so its own bands catch up.
  const onRated = useCallback(
    (leadId: string) => {
      setSnap((s) => {
        if (!s) return s;
        const leads = s.leads.filter((l) => l.id !== leadId);
        const total = Math.max(0, s.total - 1);
        if (total === 0) show(false);
        return { ...s, leads, total };
      });
      router.refresh();
    },
    [router, show],
  );

  if (!mounted || !open || !snap || snap.total === 0) return null;

  const more = snap.total - snap.leads.length;

  return createPortal(
    <div className="fixed inset-0 z-[69] grid place-items-center p-md">
      <div className="absolute inset-0 bg-black/50" onClick={dismiss} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lead-quality-reminder-title"
        aria-describedby="lead-quality-reminder-desc"
        className="relative w-full max-w-[640px] max-h-[85vh] flex flex-col bg-surface-container-lowest border-2 border-amber-500 rounded-xl shadow-xl"
      >
        <div className="flex items-start gap-md px-lg py-md border-b border-outline-variant bg-amber-50 rounded-t-xl">
          <span className="material-symbols-outlined text-amber-800 mt-xs">grade</span>
          <div className="min-w-0 flex-1">
            <h3 id="lead-quality-reminder-title" className="text-h3 text-amber-900">
              {snap.total} {snap.total === 1 ? "lead needs" : "leads need"} a quality rating
            </h3>
            <p id="lead-quality-reminder-desc" className="text-body-md text-amber-900">
              These came in over {QUALITY_DUE_AFTER_DAYS} days ago. Rate each one: was it a genuine enquiry? Their stage and
              tasks stay locked until you do.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={`Close — remind me in ${QUALITY_REMIND_EVERY_MINUTES} minutes`}
            className="h-9 w-9 grid place-items-center rounded-lg hover:bg-black/5 text-amber-900"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto divide-y divide-outline-variant px-lg">
          {snap.leads.map((lead) => (
            <ReminderRow key={lead.id} lead={lead} now={now} reasons={snap.reasons} onRated={onRated} onOpen={dismiss} />
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-sm px-lg py-md border-t border-outline-variant">
          <Link href={`/crm/leads?assignee=${userId}&quality=overdue`} onClick={dismiss} className="text-body-md text-accent hover:underline">
            {more > 0 ? `+${more} more — open the full list` : "Open in the leads list"}
          </Link>
          <button type="button" onClick={dismiss} className="h-9 px-md rounded-lg bg-primary text-on-primary font-semibold">
            Remind me in {QUALITY_REMIND_EVERY_MINUTES} min
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ReminderRow({
  lead,
  now,
  reasons,
  onRated,
  onOpen,
}: {
  lead: QualityReminderLead;
  now: number;
  reasons: QualityReminderSnapshot["reasons"];
  onRated: (leadId: string) => void;
  onOpen: () => void;
}) {
  const [rating, setRating] = useState<LeadQualityRating | "">("");
  const [reasonId, setReasonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(r: LeadQualityRating, reason: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quality: { rating: r, reasonId: qualityNeedsReason(r) ? reason : null } }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const j = res ? ((await res.json().catch(() => null)) as { message?: string } | null) : null;
      setError(j?.message ?? "That didn't save.");
      return;
    }
    onRated(lead.id);
  }

  // Good / Average save on the click; Poor / Junk wait for their reason.
  function pick(r: LeadQualityRating) {
    setRating(r);
    if (!qualityNeedsReason(r)) void save(r, "");
  }

  return (
    <li className="py-sm space-y-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-x-md">
        <Link href={`/crm/leads/${lead.id}`} onClick={onOpen} className="text-body-md font-semibold text-accent hover:underline break-words">
          {lead.candidateName}
        </Link>
        <span className="text-caption text-on-surface-variant">
          <span className="text-error font-semibold">{overdueBy(lead.dueAt, now)}</span>
          {lead.source ? ` · ${lead.source}` : ""}
          {lead.campaign ? ` · ${lead.campaign}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-xs">
        {LEAD_QUALITIES.map((q) => {
          const on = rating === q.value;
          return (
            <button
              key={q.value}
              type="button"
              disabled={busy}
              title={q.hint}
              onClick={() => pick(q.value)}
              className="inline-flex items-center gap-xs h-8 px-md rounded-lg text-label-sm font-semibold text-on-surface transition disabled:opacity-60"
              style={qualityChipStyle(q, on)}
            >
              {!on && <QualityDot color={q.color} />}
              {q.label}
            </button>
          );
        })}
        {qualityNeedsReason(rating) && (
          <>
            <select
              value={reasonId}
              disabled={busy}
              onChange={(e) => setReasonId(e.target.value)}
              aria-label="Reason"
              className="h-8 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm"
            >
              <option value="">Why?</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !reasonId}
              onClick={() => rating && void save(rating, reasonId)}
              className="h-8 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-50"
            >
              Save
            </button>
          </>
        )}
      </div>
      {error && <p className="text-label-sm text-error">{error}</p>}
    </li>
  );
}
