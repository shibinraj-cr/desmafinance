"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type MultiSelectOption = {
  value: string;
  label: string;
  /** Optional muted suffix (a count, a group name) rendered after the label. */
  hint?: string;
};

/**
 * Checkbox dropdown used by every filter band in the app.
 *
 * Shaped to sit next to the plain `<select>`s it replaced — same height, same
 * border, same type scale — so a filter row reads as one control strip. The
 * trigger summarises the selection ("Australia +2"), which keeps the row from
 * growing as more values are ticked.
 *
 * State lives in the URL, not here: `selected` comes down from the query string
 * and `onChange` pushes the next list back up. The popover closes on outside
 * click and Escape; ticking a box does *not* close it, since picking several
 * values in a row is the whole point.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  className,
  title,
  icon,
  searchable,
  disabled,
  disabledHint,
  align = "left",
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Shown on the trigger when nothing is selected, e.g. "All statuses". */
  placeholder: string;
  className?: string;
  title?: string;
  /** Material Symbols glyph name rendered before the label. */
  icon?: string;
  /** Force the filter box on/off. Defaults to on once the list gets long. */
  searchable?: boolean;
  disabled?: boolean;
  /** Trigger text while disabled, e.g. "Pick a category first". */
  disabledHint?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const showSearch = searchable ?? options.length > 8;

  // Only values that still exist as options count as selected — a stale value
  // left in the URL (a campaign that aged out of the list) shouldn't render as
  // "+1" with nothing to untick.
  const known = useMemo(() => new Set(options.map((o) => o.value)), [options]);
  const active = useMemo(() => selected.filter((v) => known.has(v)), [selected, known]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && showSearch) searchRef.current?.focus();
    if (!open) setQuery("");
  }, [open, showSearch]);

  function toggle(value: string) {
    onChange(active.includes(value) ? active.filter((v) => v !== value) : [...active, value]);
  }

  // Summary: one selection reads as its label, several as "first +N" so the
  // trigger keeps a predictable width.
  const firstLabel = active.length > 0 ? options.find((o) => o.value === active[0])?.label ?? active[0] : "";
  const summary =
    active.length === 0
      ? placeholder
      : active.length === 1
        ? firstLabel
        : `${firstLabel} +${active.length - 1}`;

  const triggerBase =
    "h-9 px-md rounded-lg border text-label-sm outline-none transition inline-flex items-center gap-xs max-w-[15rem]";
  const triggerState = disabled
    ? "border-outline-variant bg-surface-container-lowest text-on-surface-variant opacity-50 cursor-not-allowed"
    : active.length > 0
      ? "border-primary bg-primary/10 text-on-surface focus:ring-2 focus:ring-primary/30"
      : "border-outline-variant bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/30";

  return (
    <div ref={wrapRef} className={"relative " + (className ?? "")}>
      <button
        type="button"
        disabled={disabled}
        title={title ?? placeholder}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={triggerBase + " " + triggerState}
      >
        {icon && (
          <span className="material-symbols-outlined shrink-0" style={{ fontSize: 18 }} aria-hidden>
            {icon}
          </span>
        )}
        <span className="truncate">{disabled ? disabledHint ?? placeholder : summary}</span>
        {active.length > 1 && (
          <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4 text-on-primary">
            {active.length}
          </span>
        )}
        <span
          className="material-symbols-outlined shrink-0 text-on-surface-variant"
          style={{ fontSize: 18 }}
          aria-hidden
        >
          {open ? "arrow_drop_up" : "arrow_drop_down"}
        </span>
      </button>

      {/* Native checkboxes in a labelled group rather than a listbox/option
          tree: role="option" on the label would mask the checkbox's own checked
          state from screen readers. */}
      {open && !disabled && (
        <div
          id={listId}
          role="group"
          aria-label={placeholder}
          className={
            "absolute z-40 mt-1 w-64 max-w-[80vw] rounded-xl border border-outline-variant bg-surface shadow-2xl " +
            (align === "right" ? "right-0" : "left-0")
          }
        >
          {showSearch && (
            <div className="border-b border-outline-variant p-sm">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter options…"
                className="h-8 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-sm text-label-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          )}

          <div className="max-h-64 overflow-y-auto py-1">
            {visible.length === 0 && (
              <p className="px-md py-sm text-label-sm text-on-surface-variant">No matches.</p>
            )}
            {visible.map((o) => {
              const checked = active.includes(o.value);
              return (
                <label
                  key={o.value}
                  className="flex cursor-pointer items-center gap-sm px-md py-1.5 text-label-sm text-on-surface transition hover:bg-surface-container-low"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(o.value)}
                    className="h-4 w-4 shrink-0 accent-[color:var(--md-sys-color-primary,currentColor)]"
                  />
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="ml-auto shrink-0 text-on-surface-variant">{o.hint}</span>}
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-sm border-t border-outline-variant px-md py-sm">
            <span className="text-label-sm text-on-surface-variant">
              {active.length === 0 ? placeholder : `${active.length} selected`}
            </span>
            <div className="flex items-center gap-sm">
              {/* "All" ticks everything currently visible, so it doubles as
                  "select all matching this search". */}
              <button
                type="button"
                onClick={() => onChange(Array.from(new Set([...active, ...visible.map((o) => o.value)])))}
                className="text-label-sm font-semibold text-primary hover:underline"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={active.length === 0}
                className="text-label-sm font-semibold text-on-surface-variant hover:text-on-surface disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
