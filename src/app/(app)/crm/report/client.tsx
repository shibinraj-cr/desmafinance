"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { addDays, todayIst, formatIstShort } from "@/lib/lead-pulse-dates";

const controlClass =
  "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition";

type Bde = { userId: string; displayName: string };

/**
 * Day navigator + (for managers) BDE selector. Mirrors the CRM filter pattern:
 * mutate a `URLSearchParams` copy and `router.push`, so the server component
 * re-renders for the new day / person. Prev-day and next-day step through IST
 * calendar days; next is disabled once the day is today (no future reports).
 */
export function DayNav({
  day,
  bde,
  bdes,
  showBde,
  allLabel = "Team roll-up",
}: {
  day: string;
  bde: string | null;
  bdes: Bde[];
  showBde: boolean;
  /** The BDE picker's no-selection option ("Me" on My Day). */
  allLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const today = todayIst();

  function go(patch: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const atToday = day >= today;

  return (
    <div className="flex flex-wrap items-center gap-base">
      <div className="inline-flex items-center gap-xs">
        <button
          type="button"
          onClick={() => go({ date: prev })}
          className={controlClass + " w-9 px-0"}
          aria-label="Previous day"
        >
          ‹
        </button>
        <input
          type="date"
          className={controlClass}
          value={day}
          max={today}
          onChange={(e) => go({ date: e.target.value || today })}
          aria-label="Report day"
        />
        <button
          type="button"
          onClick={() => (atToday ? undefined : go({ date: next }))}
          disabled={atToday}
          className={controlClass + " w-9 px-0 disabled:opacity-40"}
          aria-label="Next day"
        >
          ›
        </button>
        {day !== today && (
          <button type="button" onClick={() => go({ date: today })} className="text-label-sm font-semibold text-primary hover:underline">
            Today
          </button>
        )}
      </div>
      <span className="text-label-sm text-on-surface-variant">{formatIstShort(day)}</span>

      {showBde && (
        <select
          className={controlClass}
          value={bde ?? "team"}
          onChange={(e) => go({ bde: e.target.value === "team" ? null : e.target.value })}
          aria-label="Select BDE"
        >
          <option value="team">{allLabel}</option>
          {bdes.map((b) => (
            <option key={b.userId} value={b.userId}>
              {b.displayName}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/**
 * The BDE's optional remarks on their day. The report itself is generated
 * automatically at the cutoff — nothing to submit — and remarks never change
 * its numbers. Editable until a manager reviews the report.
 */
export function ReportForm({
  day,
  initial,
}: {
  day: string;
  initial: { summary: string; blockers: string; planNext: string };
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(initial.summary);
  const [blockers, setBlockers] = useState(initial.blockers);
  const [planNext, setPlanNext] = useState(initial.planNext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = summary !== initial.summary || blockers !== initial.blockers || planNext !== initial.planNext;

  async function submit() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/crm/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, summary, blockers, planNext }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(errorText(data?.error) ?? data?.message ?? "Could not save — please try again.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-md">
      <Field label="Remarks" hint="Optional — anything the numbers don't show.">
        <textarea
          className={textareaClass}
          rows={4}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="e.g. Two candidates waiting on IELTS/OET results; one asked for an EMI plan; a hot lead wants a call back Friday…"
        />
      </Field>
      <div className="grid grid-cols-1 gap-md md:grid-cols-2">
        <Field label="Blockers / help needed" hint="Optional.">
          <textarea className={textareaClass} rows={3} value={blockers} onChange={(e) => setBlockers(e.target.value)} />
        </Field>
        <Field label="Plan for next day" hint="Optional.">
          <textarea className={textareaClass} rows={3} value={planNext} onChange={(e) => setPlanNext(e.target.value)} />
        </Field>
      </div>
      {error && <p className="text-label-sm font-semibold text-error">{error}</p>}
      <div className="flex items-center gap-base">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !changed}
          className="h-10 rounded-lg bg-primary px-lg text-label-sm font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save remarks"}
        </button>
        {saved && !changed && <span className="text-caption text-green-800">Saved</span>}
      </div>
    </div>
  );
}

/** Manager sign-off on a submitted report. */
export function ReviewPanel({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/report/${reportId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerNote: note }),
      });
      if (!res.ok) {
        setError("Could not mark reviewed — please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-md">
      <Field label="Reviewer note" hint="Optional — feedback for the BDE.">
        <textarea className={textareaClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <p className="text-label-sm font-semibold text-error">{error}</p>}
      <button
        type="button"
        onClick={review}
        disabled={busy}
        className="h-10 rounded-lg bg-primary px-lg text-label-sm font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Mark reviewed"}
      </button>
    </div>
  );
}

const textareaClass =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm text-label-sm text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-xs block text-label-sm font-semibold text-on-surface">
        {label}
        {hint && <span className="ml-xs font-normal text-caption text-on-surface-variant">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function errorText(code: unknown): string | null {
  switch (code) {
    case "already_reviewed":
      return "This report was already reviewed and can no longer be changed.";
    case "day_out_of_window":
      return "That day is outside the window you can still report on.";
    case "invalid_day":
      return "Invalid day.";
    case "not_a_bde":
      return "Only BDEs can submit a daily report.";
    default:
      return null;
  }
}
