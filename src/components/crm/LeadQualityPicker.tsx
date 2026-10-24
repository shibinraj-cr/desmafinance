"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  LEAD_QUALITIES,
  QUALITY_NOTE_MAX,
  leadQualityMeta,
  qualityNeedsReason,
  type LeadQualityRating,
  type QualityReasonOpt,
} from "@/lib/crm-lead-quality";

/**
 * The lead-quality controls shared by every place a consultant rates a lead:
 * the band and dialog on the lead page, the close / enroll forms, the reminder
 * pop-up and the WhatsApp inbox. One picker so the rule reads the same
 * everywhere: four ratings, and Poor / Junk must say why.
 */

export type QualityDraft = { rating: LeadQualityRating | ""; reasonId: string; note: string };

export function qualityDraftFrom(
  q?: { rating: LeadQualityRating | null; reason: { id: string } | null; note: string | null } | null,
): QualityDraft {
  return { rating: q?.rating ?? "", reasonId: q?.reason?.id ?? "", note: q?.note ?? "" };
}

/** What's still missing, or null when the draft can be sent. */
export function qualityDraftError(d: QualityDraft): string | null {
  if (!d.rating) return "Pick the lead's quality.";
  if (qualityNeedsReason(d.rating) && !d.reasonId) return `Pick a reason for ${leadQualityMeta(d.rating)!.label}.`;
  return null;
}

/** The `quality` body the APIs accept. Call only once qualityDraftError is null. */
export function qualityPayload(d: QualityDraft) {
  return {
    rating: d.rating as LeadQualityRating,
    reasonId: qualityNeedsReason(d.rating) ? d.reasonId : null,
    note: d.note.trim() || null,
  };
}

/** The rating's colour as a dot. Labels stay in text ink: the pale steps would be unreadable as text. */
export function QualityDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span aria-hidden className="inline-block rounded-full shrink-0" style={{ width: size, height: size, backgroundColor: color }} />;
}

export function QualityPill({ rating }: { rating: string | null }) {
  const meta = leadQualityMeta(rating);
  if (!meta) return <span className="text-on-surface-variant">—</span>;
  return (
    <span
      className="inline-flex items-center gap-[5px] px-xs py-[2px] rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap text-on-surface"
      style={{ border: `1px solid ${meta.color}` }}
    >
      <QualityDot color={meta.color} size={7} />
      {meta.label}
    </span>
  );
}

/**
 * A rating as a selectable chip: filled in its colour (with its own ink) when
 * picked, otherwise a coloured dot and border around plain text.
 */
export function qualityChipStyle(q: { color: string; ink: string }, on: boolean): React.CSSProperties {
  return on
    ? { backgroundColor: q.color, color: q.ink, border: `1px solid ${q.color}`, boxShadow: `0 0 0 3px ${q.color}40` }
    : { border: `1px solid ${q.color}` };
}

const fieldCls =
  "w-full h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition";

export function LeadQualityPicker({
  value,
  onChange,
  reasons,
  disabled = false,
  showNote = true,
}: {
  value: QualityDraft;
  onChange: (next: QualityDraft) => void;
  reasons: QualityReasonOpt[];
  disabled?: boolean;
  showNote?: boolean;
}) {
  const needsReason = qualityNeedsReason(value.rating);
  return (
    <div className="space-y-sm">
      <div role="radiogroup" aria-label="Lead quality" className="grid grid-cols-2 sm:grid-cols-4 gap-xs">
        {LEAD_QUALITIES.map((q) => {
          const on = value.rating === q.value;
          return (
            <button
              key={q.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              title={q.hint}
              onClick={() => onChange({ ...value, rating: q.value })}
              className="inline-flex items-center justify-center gap-xs h-9 px-sm rounded-lg text-label-sm font-semibold text-on-surface bg-surface-container-lowest transition disabled:opacity-60"
              style={qualityChipStyle(q, on)}
            >
              {!on && <QualityDot color={q.color} />}
              {q.label}
            </button>
          );
        })}
      </div>
      {value.rating && (
        <p className="text-caption text-on-surface-variant">{leadQualityMeta(value.rating)?.hint}</p>
      )}
      {needsReason && (
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Reason (required)</span>
          <select
            className={fieldCls}
            value={value.reasonId}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, reasonId: e.target.value })}
          >
            <option value="">Select a reason…</option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {showNote && (
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Note (optional)</span>
          <input
            className={fieldCls}
            value={value.note}
            maxLength={QUALITY_NOTE_MAX}
            disabled={disabled}
            placeholder="Anything marketing should know about this enquiry"
            onChange={(e) => onChange({ ...value, note: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}

/**
 * Rate (or re-rate) one lead in a dialog. Saves through the lead PATCH, which
 * logs the change on the timeline. `required` is the overdue case: the copy
 * says why it appeared, and dismissing it only defers it — the stage and task
 * gates still hold until the lead is rated.
 */
export function LeadQualityDialog({
  leadId,
  leadName,
  initial,
  reasons,
  required = false,
  requiredMessage,
  onClose,
  onSaved,
}: {
  leadId: string;
  leadName: string;
  initial: QualityDraft;
  reasons: QualityReasonOpt[];
  required?: boolean;
  requiredMessage?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState<QualityDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function save() {
    const problem = qualityDraftError(draft);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quality: qualityPayload(draft) }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      setError(j.message || "Couldn't save the rating. Please try again.");
      return;
    }
    onSaved();
  }

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-quality-title"
        onClick={(e) => e.stopPropagation()}
        className={
          "w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface-container-lowest rounded-xl shadow-lg p-lg space-y-md border " +
          (required ? "border-2 border-error" : "border-outline-variant")
        }
      >
        <div>
          <h3 id="lead-quality-title" className="text-h3 text-on-surface">
            {required ? "Rate this lead's quality first" : "Lead quality"}
          </h3>
          <p className="text-body-md text-on-surface-variant">{leadName}</p>
        </div>
        {required && requiredMessage && (
          <p className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">{requiredMessage}</p>
        )}
        <LeadQualityPicker value={draft} onChange={setDraft} reasons={reasons} disabled={busy} />
        {error && <p className="text-label-sm text-error">{error}</p>}
        <div className="flex flex-wrap justify-end gap-base pt-xs">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
          >
            {required ? "Not now" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save rating"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
