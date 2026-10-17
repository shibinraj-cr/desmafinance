"use client";

import { useState } from "react";
import { MERGE_KEYS } from "@/lib/esign/merge-keys";
import {
  ALIGNMENTS,
  FIELD_TYPES,
  FIELD_TYPE_ICONS,
  FIELD_TYPE_LABELS,
  MERGEABLE_TYPES,
  OPTION_TYPES,
  SIGNER_ROLES,
  TEXT_TYPES,
  clampBox,
  parsePageList,
  type FieldType,
} from "@/lib/esign/template-fields";
import type { PageGeometry } from "@/lib/esign/templates";
import { ROLE_STYLES, fieldCaption, type BuilderField } from "./BuilderPage";

const inputCls =
  "w-full h-9 px-sm rounded-md border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none text-body-md disabled:opacity-60";
const btn =
  "inline-flex items-center justify-center gap-xs px-sm py-xs rounded-md border border-outline-variant text-body-md font-semibold hover:bg-surface-container disabled:opacity-50";

function Label({ children }: { children: React.ReactNode }) {
  return <span className="block text-label-sm text-on-surface-variant mb-xs">{children}</span>;
}

const pct = (n: number) => Math.round(n * 1000) / 10;

/** Merge keys grouped for the <select>. */
const MERGE_GROUPS = ["Client", "Deal", "Other"].map((g) => ({ group: g, keys: MERGE_KEYS.filter((k) => k.group === g) }));

export function FieldProperties({
  field: f,
  pages,
  readOnly,
  keyTaken,
  onChange,
  onTypeChange,
  onMergeKeyChange,
  onDuplicate,
  onCopyToPages,
  onDelete,
}: {
  field: BuilderField;
  pages: PageGeometry[];
  readOnly: boolean;
  keyTaken: (key: string) => boolean;
  /** Patch the field; `merge` coalesces rapid edits of one input into a single undo step. */
  onChange: (patch: Partial<BuilderField>, merge?: string) => void;
  onTypeChange: (type: FieldType) => void;
  onMergeKeyChange: (mergeKey: string | null) => void;
  onDuplicate: () => void;
  onCopyToPages: (pages: number[]) => number;
  onDelete: () => void;
}) {
  const [copyTo, setCopyTo] = useState("all");
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const geom = pages[f.page - 1];
  const keyError = !/^[a-z][a-z0-9_]{0,59}$/.test(f.key)
    ? "Start with a letter; use a–z, 0–9 and _."
    : keyTaken(f.key)
      ? "Another field already uses this key."
      : null;

  function setGeometry(part: "x" | "y" | "w" | "h", value: string) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    onChange(clampBox({ x: f.x, y: f.y, w: f.w, h: f.h, [part]: n / 100 }, geom), `geom-${part}`);
  }

  return (
    <fieldset disabled={readOnly} className="space-y-md">
      <div className="flex items-center gap-xs">
        <span className="material-symbols-outlined" aria-hidden="true">
          {FIELD_TYPE_ICONS[f.type]}
        </span>
        <h4 className="font-bold text-body-md truncate">{fieldCaption(f)}</h4>
      </div>

      <label className="block">
        <Label>Type</Label>
        <select className={inputCls} value={f.type} onChange={(e) => onTypeChange(e.target.value as FieldType)}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      <div>
        <Label>Filled by</Label>
        <div className="flex gap-xs" role="radiogroup" aria-label="Filled by">
          {SIGNER_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={f.role === r}
              className={
                "flex-1 h-9 rounded-md border text-body-md font-semibold " +
                (f.role === r ? ROLE_STYLES[r].chip : "border-outline-variant hover:bg-surface-container")
              }
              onClick={() => onChange({ role: r })}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {MERGEABLE_TYPES.includes(f.type) && (
        <label className="block">
          <Label>Fill from CRM</Label>
          <select className={inputCls} value={f.mergeKey ?? ""} onChange={(e) => onMergeKeyChange(e.target.value || null)}>
            <option value="">No — the signer types it</option>
            {MERGE_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.keys.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                    {k.from.kind === "manual" ? " (typed by staff when sending)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {f.mergeKey && (
            <span className="block text-caption text-on-surface-variant mt-xs">
              Filled in when the agreement is sent; the signer cannot change it.
            </span>
          )}
        </label>
      )}

      <label className="block">
        <Label>Label</Label>
        <input
          className={inputCls}
          value={f.label ?? ""}
          maxLength={120}
          placeholder={FIELD_TYPE_LABELS[f.type]}
          onChange={(e) => onChange({ label: e.target.value || null }, "label")}
        />
      </label>

      <label className="block">
        <Label>Key</Label>
        <input
          className={inputCls + " font-mono" + (keyError ? " border-error" : "")}
          value={f.key}
          maxLength={60}
          onChange={(e) => onChange({ key: e.target.value.toLowerCase().replace(/[\s-]+/g, "_") }, "key")}
          aria-invalid={!!keyError}
        />
        <span className={"block text-caption mt-xs " + (keyError ? "text-error" : "text-on-surface-variant")}>
          {keyError ?? "Stable name for this field in reports and integrations."}
        </span>
      </label>

      {!f.mergeKey && f.role === "DESMA" && (
        <label className="flex items-center gap-sm text-body-md text-on-surface-variant">
          <input type="checkbox" checked disabled />
          Always required — DESMA must fill every box before the client gets the agreement
        </label>
      )}
      {!f.mergeKey && f.role !== "DESMA" && f.type !== "checkbox" && (
        <label className="flex items-center gap-sm text-body-md">
          <input type="checkbox" checked={f.required} onChange={(e) => onChange({ required: e.target.checked })} />
          Required to finish signing
        </label>
      )}
      {f.role !== "DESMA" && f.type === "checkbox" && (
        <label className="flex items-center gap-sm text-body-md">
          <input type="checkbox" checked={f.required} onChange={(e) => onChange({ required: e.target.checked })} />
          Must be ticked to finish signing
        </label>
      )}

      {OPTION_TYPES.includes(f.type) && (
        <label className="block">
          <Label>Choices (one per line)</Label>
          <textarea
            className={inputCls + " h-auto py-xs"}
            rows={4}
            value={(f.options ?? []).join("\n")}
            onChange={(e) => onChange({ options: e.target.value.split("\n") }, "options")}
          />
        </label>
      )}

      {TEXT_TYPES.includes(f.type) && (
        <div className="grid grid-cols-2 gap-sm">
          <label className="block">
            <Label>Font size</Label>
            <input
              className={inputCls}
              type="number"
              min={6}
              max={36}
              value={f.fontSize}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (n >= 6 && n <= 36) onChange({ fontSize: n }, "fontSize");
              }}
            />
          </label>
          <label className="block">
            <Label>Align</Label>
            <select className={inputCls} value={f.alignment} onChange={(e) => onChange({ alignment: e.target.value as BuilderField["alignment"] })}>
              {ALIGNMENTS.map((a) => (
                <option key={a} value={a}>
                  {a[0].toUpperCase() + a.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div>
        <Label>Position (% of page)</Label>
        <div className="grid grid-cols-4 gap-xs">
          {(["x", "y", "w", "h"] as const).map((k) => (
            <label key={k} className="block">
              <span className="block text-caption text-on-surface-variant text-center uppercase">{k}</span>
              <input
                className={inputCls + " px-xs text-center tabular-nums"}
                type="number"
                step={0.1}
                min={0}
                max={100}
                value={pct(f[k])}
                onChange={(e) => setGeometry(k, e.target.value)}
                aria-label={{ x: "Left", y: "Top", w: "Width", h: "Height" }[k] + " (% of page)"}
              />
            </label>
          ))}
        </div>
      </div>

      <label className="block">
        <Label>Page</Label>
        <select
          className={inputCls}
          value={f.page}
          onChange={(e) => {
            const page = Number(e.target.value);
            onChange({ page, ...clampBox(f, pages[page - 1]) });
          }}
        >
          {pages.map((_, i) => (
            <option key={i} value={i + 1}>
              Page {i + 1}
            </option>
          ))}
        </select>
      </label>

      {!readOnly && (
        <div className="space-y-sm border-t border-outline-variant pt-md">
          <div className="flex flex-wrap gap-xs">
            <button type="button" className={btn} onClick={onDuplicate} title="Duplicate (⌘/Ctrl + D)">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                content_copy
              </span>
              Duplicate
            </button>
            <button type="button" className={btn + " text-error"} onClick={onDelete} title="Delete (Delete key)">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                delete
              </span>
              Delete
            </button>
          </div>
          {pages.length > 1 && (
            <div>
              <Label>Copy to other pages</Label>
              <div className="flex gap-xs">
                <input
                  className={inputCls}
                  value={copyTo}
                  onChange={(e) => {
                    setCopyTo(e.target.value);
                    setCopyMsg(null);
                  }}
                  placeholder="all, or 2-5, 7"
                  aria-label="Pages to copy to"
                />
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    const list = parsePageList(copyTo, pages.length);
                    if (!list) return setCopyMsg(`Use "all" or page numbers 1–${pages.length}, like 2-5, 7.`);
                    const n = onCopyToPages(list);
                    setCopyMsg(n ? `Copied to ${n} page${n === 1 ? "" : "s"}.` : "Nothing to copy: that is this field's own page.");
                  }}
                >
                  Copy
                </button>
              </div>
              <span className="block text-caption text-on-surface-variant mt-xs">
                {copyMsg ?? "Same spot on each page — handy for initials on every page."}
              </span>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

export function FieldList({
  fields,
  numPages,
  selected,
  onSelect,
}: {
  fields: BuilderField[];
  numPages: number;
  selected: string | null;
  onSelect: (uid: string) => void;
}) {
  if (fields.length === 0) {
    return <p className="text-body-md text-on-surface-variant">No fields yet.</p>;
  }
  return (
    <div className="space-y-sm">
      {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => {
        const onPage = fields.filter((f) => f.page === page).sort((a, b) => a.y - b.y || a.x - b.x);
        if (!onPage.length) return null;
        return (
          <div key={page}>
            <div className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">Page {page}</div>
            <ul className="space-y-[2px]">
              {onPage.map((f) => (
                <li key={f.uid}>
                  <button
                    type="button"
                    onClick={() => onSelect(f.uid)}
                    className={
                      "w-full flex items-center gap-xs px-xs py-[3px] rounded text-left text-body-md hover:bg-surface-container " +
                      (f.uid === selected ? "bg-surface-container font-semibold" : "")
                    }
                  >
                    <span className="material-symbols-outlined text-[16px] shrink-0" aria-hidden="true">
                      {FIELD_TYPE_ICONS[f.type]}
                    </span>
                    <span className="truncate flex-1">{fieldCaption(f)}</span>
                    {f.mergeKey && <span className="text-caption text-on-surface-variant">CRM</span>}
                    <span className={"text-caption px-xs rounded border " + (ROLE_STYLES[f.role] ?? ROLE_STYLES.Client).chip}>
                      {f.role}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
