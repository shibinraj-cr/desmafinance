"use client";

import { useEffect, useState } from "react";

export type LeadPick = { id: string; name: string; hint?: string };

/**
 * Pick one CRM lead by name, phone or email (GET /api/crm/leads/search). Shows
 * the pick with a Change link once chosen. Used for "Referred by".
 */
export function LeadSearchPicker({
  value,
  onChange,
  placeholder = "Search by name, phone or email",
  inputClassName,
  excludeId,
  disabled,
}: {
  value: LeadPick | null;
  onChange: (v: LeadPick | null) => void;
  placeholder?: string;
  inputClassName: string;
  /** A lead that mustn't be offered (the one being edited). */
  excludeId?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeadPick[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/crm/leads/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { leads: [] }))
        .then((j: { leads: LeadPick[] }) => setHits(j.leads.filter((l) => l.id !== excludeId)))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [q, excludeId]);

  if (value) {
    return (
      <div className="flex items-center gap-xs h-10 px-md rounded-lg border border-outline-variant bg-surface-container-low text-body-md">
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 18 }}>
          person
        </span>
        <span className="truncate flex-1 text-on-surface">{value.name}</span>
        {!disabled && (
          <button type="button" className="text-label-sm font-semibold text-primary hover:underline" onClick={() => onChange(null)}>
            Change
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        className={inputClassName}
        value={q}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && hits.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-auto bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg"
        >
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full text-left px-md py-sm hover:bg-surface-container-low"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(h);
                  setQ("");
                  setOpen(false);
                }}
              >
                <span className="font-medium text-on-surface">{h.name}</span>
                {h.hint ? <span className="text-label-sm text-on-surface-variant"> · {h.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
