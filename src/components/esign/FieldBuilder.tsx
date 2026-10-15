"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { mergeKeyLabel } from "@/lib/esign/merge-keys";
import type { PageGeometry } from "@/lib/esign/templates";
import {
  FIELD_TYPES,
  FIELD_TYPE_ICONS,
  FIELD_TYPE_LABELS,
  MERGEABLE_TYPES,
  OPTION_TYPES,
  SIGNER_ROLES,
  clampBox,
  copyFieldToPages,
  fieldWarnings,
  isAutoKey,
  keyForMergeKey,
  minSizeFrac,
  newField,
  normalizeField,
  uniqueKey,
  validateFields,
  type FieldType,
  type SignerRole,
  type TemplateField,
} from "@/lib/esign/template-fields";
import { BuilderPage, FIELD_DRAG_MIME, ROLE_STYLES, type BuilderField } from "./BuilderPage";
import { FieldList, FieldProperties } from "./FieldPanel";
import { fetchPdfBytes, openPdf } from "./pdf-client";

/**
 * The agreement field builder: the template PDF drawn page by page, field
 * boxes laid over it in page fractions, and everything needed to place them —
 * drag from the palette, move, resize, nudge, duplicate, copy across pages,
 * undo. Saving sends the whole layout; the server decides whether that edits
 * this version or (if it was already sent) becomes the next one.
 */

type Props = {
  templateId: string;
  templateName: string;
  version: { id: string; version: number; numPages: number; fileSize: number; pages: PageGeometry[] };
  initialFields: TemplateField[];
  /** The template's updatedAt when this page loaded, to detect someone else's save. */
  updatedAt: string;
  /** Agreements already sent from this version (saving will fork if > 0). */
  sentCount: number;
  readOnly: boolean;
  readOnlyReason: string | null;
  /** Set after a save forked a new version: the version number it came from. */
  forkedFrom: number | null;
};

let uidSeq = 0;
/** Ids for fields added in the browser. Never used during render, so SSR cannot disagree. */
const newUid = () => `n${++uidSeq}-${Math.random().toString(36).slice(2, 7)}`;
const withUid = (f: TemplateField): BuilderField => ({ ...f, uid: newUid() });
/** Ids for the fields the page loaded with: by position, identical on server and client. */
const initialUids = (fields: TemplateField[]): BuilderField[] => fields.map((f, i) => ({ ...f, uid: `i${i}` }));

/** The layout as the server will store it — the basis for "unsaved changes". */
function toPayload(fields: BuilderField[]): TemplateField[] {
  return fields.map(({ uid: _uid, ...f }) =>
    normalizeField({
      ...f,
      label: f.label?.trim() || null,
      options: f.options ? f.options.map((o) => o.trim()).filter(Boolean) : null,
    }),
  );
}
const snapshot = (fields: BuilderField[]) =>
  JSON.stringify([...toPayload(fields)].sort((a, b) => a.key.localeCompare(b.key)));

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function FieldBuilder(props: Props) {
  const { templateId, version, readOnly } = props;
  const pages = version.pages;
  const router = useRouter();

  const [fields, setFields] = useState<BuilderField[]>(() => initialUids(props.initialFields));
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(initialUids(props.initialFields)));
  const [selected, setSelected] = useState<string | null>(null);
  const [placeRole, setPlaceRole] = useState<SignerRole>("Client");
  const [activePage, setActivePage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(props.updatedAt);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showChecks, setShowChecks] = useState(false);

  // ─── History ──────────────────────────────────────────────────────────────
  const past = useRef<BuilderField[][]>([]);
  const future = useRef<BuilderField[][]>([]);
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  /** Record the current layout before a change. Rapid edits sharing `merge` collapse into one step. */
  const remember = useCallback((merge?: string) => {
    const now = Date.now();
    if (merge && lastMerge.current?.key === merge && now - lastMerge.current.at < 1200) {
      lastMerge.current.at = now;
      return;
    }
    past.current.push(fieldsRef.current);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    lastMerge.current = merge ? { key: merge, at: now } : null;
    rerender();
  }, []);

  const change = useCallback(
    (update: (fs: BuilderField[]) => BuilderField[], merge?: string) => {
      remember(merge);
      setFields(update);
    },
    [remember],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(fieldsRef.current);
    lastMerge.current = null;
    setFields(prev);
    rerender();
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(fieldsRef.current);
    lastMerge.current = null;
    setFields(next);
    rerender();
  }, []);

  // ─── PDF ──────────────────────────────────────────────────────────────────
  const fileUrl = `/api/esign/templates/${templateId}/versions/${version.id}/file`;
  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const bytes = await fetchPdfBytes(fileUrl, version.fileSize);
        opened = await openPdf(bytes);
        if (cancelled) return void opened.destroy();
        setDoc(opened);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "The PDF could not be loaded.");
      }
    })();
    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [fileUrl, version.fileSize]);

  useEffect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller]);

  // CSS pixels per PDF point: the widest page fits the column at 100%.
  const maxPageW = Math.max(...pages.map((p) => p.w));
  const scale = (Math.min(Math.max(containerWidth - 32, 280), 900) * zoom) / maxPageW;
  const [renderScale, setRenderScale] = useState(scale);
  useEffect(() => {
    const t = setTimeout(() => setRenderScale(scale), 200);
    return () => clearTimeout(t);
  }, [scale]);

  // The page under the middle of the viewport is where a clicked palette item lands.
  useEffect(() => {
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const mid = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
        for (const el of Array.from(scroller.querySelectorAll<HTMLElement>("[data-page]"))) {
          const r = el.getBoundingClientRect();
          if (r.top <= mid && r.bottom >= mid) return setActivePage(Number(el.dataset.page));
        }
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scroller]);

  // ─── Editing ──────────────────────────────────────────────────────────────
  const keysExcept = useCallback(
    (uid?: string) => fieldsRef.current.filter((f) => f.uid !== uid).map((f) => f.key),
    [],
  );

  const addField = useCallback(
    (type: FieldType, pageNo: number, center?: { x: number; y: number }) => {
      let at = center;
      if (!at && scroller) {
        // Centre of the part of the page that is on screen.
        const el = scroller.querySelector<HTMLElement>(`[data-page="${pageNo}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          const v = scroller.getBoundingClientRect();
          const top = Math.max(r.top, v.top);
          const bottom = Math.min(r.bottom, v.bottom);
          if (bottom > top) at = { x: 0.5, y: ((top + bottom) / 2 - r.top) / r.height };
        }
      }
      const f = withUid(newField(type, pageNo, at ?? { x: 0.5, y: 0.5 }, pages[pageNo - 1], keysExcept(), placeRole));
      change((fs) => [...fs, f]);
      setSelected(f.uid);
    },
    [change, keysExcept, pages, placeRole, scroller],
  );

  const patchField = useCallback(
    (uid: string, patch: Partial<BuilderField>, merge?: string) =>
      change((fs) => fs.map((f) => (f.uid === uid ? { ...f, ...patch } : f)), merge ? `${merge}:${uid}` : undefined),
    [change],
  );

  const deleteField = useCallback(
    (uid: string) => {
      change((fs) => fs.filter((f) => f.uid !== uid));
      setSelected(null);
    },
    [change],
  );

  const duplicateField = useCallback(
    (uid: string) => {
      const f = fieldsRef.current.find((x) => x.uid === uid);
      if (!f) return;
      const geom = pages[f.page - 1];
      const copy: BuilderField = {
        ...f,
        uid: newUid(),
        key: uniqueKey(f.key.replace(/_\d+$/, ""), keysExcept()),
        ...clampBox({ x: f.x + 10 / geom.w, y: f.y + 10 / geom.h, w: f.w, h: f.h }, geom),
      };
      change((fs) => [...fs, copy]);
      setSelected(copy.uid);
    },
    [change, keysExcept, pages],
  );

  // Pointer drag (move / resize), tracked on window so fast moves never "drop" the box.
  const drag = useRef<{
    uid: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
    rect: DOMRect;
    geom: PageGeometry;
    moved: boolean;
  } | null>(null);

  const onPointerDownField = useCallback(
    (e: React.PointerEvent, uid: string, mode: "move" | "resize") => {
      setSelected(uid);
      if (readOnly || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const f = fieldsRef.current.find((x) => x.uid === uid);
      const pageEl = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-page]");
      if (!f || !pageEl) return;
      setActivePage(f.page);
      drag.current = {
        uid,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        orig: { x: f.x, y: f.y, w: f.w, h: f.h },
        rect: pageEl.getBoundingClientRect(),
        geom: pages[f.page - 1],
        moved: false,
      };
    },
    [pages, readOnly],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dxPx = e.clientX - d.startX;
      const dyPx = e.clientY - d.startY;
      if (!d.moved) {
        if (Math.abs(dxPx) + Math.abs(dyPx) < 3) return;
        d.moved = true;
        remember();
      }
      const dx = dxPx / d.rect.width;
      const dy = dyPx / d.rect.height;
      let box;
      if (d.mode === "move") {
        box = clampBox({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }, d.geom);
      } else {
        const min = minSizeFrac(d.geom);
        box = {
          x: d.orig.x,
          y: d.orig.y,
          w: Math.min(1 - d.orig.x, Math.max(min.w, d.orig.w + dx)),
          h: Math.min(1 - d.orig.y, Math.max(min.h, d.orig.h + dy)),
        };
      }
      setFields((fs) => fs.map((f) => (f.uid === d.uid ? { ...f, ...box } : f)));
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [remember]);

  // ─── Checks & saving ──────────────────────────────────────────────────────
  const payload = useMemo(() => toPayload(fields), [fields]);
  const errors = useMemo(() => validateFields(payload, version.numPages), [payload, version.numPages]);
  const warnings = useMemo(() => fieldWarnings(payload), [payload]);
  const dirty = !readOnly && snapshot(fields) !== savedSnapshot;

  const save = useCallback(async () => {
    if (readOnly || saving) return;
    if (errors.length) {
      setShowChecks(true);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/esign/templates/${templateId}/versions/${version.id}/fields`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields: payload, expectedUpdatedAt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? data.issues?.[0]?.message ?? "Could not save. Try again.");
      setExpectedUpdatedAt(data.updatedAt);
      setSavedSnapshot(snapshot(fieldsRef.current));
      setSavedAt(Date.now());
      if (data.forked) {
        router.replace(`/operations/agreements/templates/${templateId}/builder?forked=${version.version}`);
        router.refresh();
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }, [errors.length, expectedUpdatedAt, payload, readOnly, router, saving, templateId, version.id, version.version]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Keyboard: Delete, arrows (nudge 1pt, Shift 10pt), ⌘D, ⌘Z / ⇧⌘Z, ⌘S, Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (readOnly || isTyping(e.target)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      const f = fieldsRef.current.find((x) => x.uid === selected);
      if (!f) return;
      if (e.key === "Escape") return setSelected(null);
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        return deleteField(f.uid);
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        return duplicateField(f.uid);
      }
      const step = e.shiftKey ? 10 : 1;
      const geom = pages[f.page - 1];
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step / geom.w, 0],
        ArrowRight: [step / geom.w, 0],
        ArrowUp: [0, -step / geom.h],
        ArrowDown: [0, step / geom.h],
      };
      const d = delta[e.key];
      if (!d) return;
      e.preventDefault();
      patchField(f.uid, clampBox({ x: f.x + d[0], y: f.y + d[1], w: f.w, h: f.h }, geom), "nudge");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteField, duplicateField, pages, patchField, readOnly, redo, save, selected, undo]);

  const selectField = useCallback(
    (uid: string | null, page: number) => {
      setSelected(uid);
      setActivePage(page);
    },
    [],
  );

  const onDropField = useCallback(
    (type: string, page: number, at: { x: number; y: number }) => {
      if ((FIELD_TYPES as readonly string[]).includes(type)) addField(type as FieldType, page, at);
    },
    [addField],
  );

  const sel = fields.find((f) => f.uid === selected) ?? null;
  const byPage = useMemo(() => {
    const m = new Map<number, BuilderField[]>();
    for (const f of fields) m.set(f.page, [...(m.get(f.page) ?? []), f]);
    return m;
  }, [fields]);

  function scrollToField(uid: string) {
    setSelected(uid);
    scroller?.querySelector(`[data-uid="${uid}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function onTypeChange(type: FieldType) {
    if (!sel) return;
    const patch: Partial<BuilderField> = { type };
    if (OPTION_TYPES.includes(type) && !sel.options?.length) patch.options = ["Option 1", "Option 2"];
    if (!OPTION_TYPES.includes(type)) patch.options = null;
    if (!MERGEABLE_TYPES.includes(type)) patch.mergeKey = null;
    if (isAutoKey(sel.key, sel.type)) patch.key = uniqueKey(type, keysExcept(sel.uid));
    patchField(sel.uid, patch);
  }

  function onMergeKeyChange(mergeKey: string | null) {
    if (!sel) return;
    const patch: Partial<BuilderField> = { mergeKey };
    if (mergeKey) {
      patch.required = false;
      if (!sel.label) patch.label = mergeKeyLabel(mergeKey);
      if (isAutoKey(sel.key, sel.type)) patch.key = keyForMergeKey(mergeKey, keysExcept(sel.uid));
    }
    patchField(sel.uid, patch);
  }

  const backHref = `/operations/agreements/templates/${templateId}`;

  return (
    <div className="flex flex-col lg:h-[calc(100vh-7.5rem)] lg:min-h-[560px]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-sm px-md py-sm border-b border-outline-variant bg-surface">
        <Link
          href={backHref}
          className="inline-flex items-center gap-xs text-body-md text-on-surface-variant hover:underline"
          onClick={(e) => {
            if (dirty && !window.confirm("You have unsaved field changes. Leave without saving?")) e.preventDefault();
          }}
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            arrow_back
          </span>
          {props.templateName}
        </Link>
        <span className="text-caption px-xs py-[1px] rounded bg-surface-container font-semibold">
          v{version.version} · {version.numPages} page{version.numPages === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-xs" aria-label="Zoom">
          <button
            type="button"
            className="h-8 w-8 grid place-items-center rounded-md border border-outline-variant hover:bg-surface-container disabled:opacity-40"
            onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] ?? 1)}
            disabled={zoom <= ZOOMS[0]}
            aria-label="Zoom out"
          >
            <span className="material-symbols-outlined text-[18px]">remove</span>
          </button>
          <button type="button" className="text-body-md tabular-nums w-14 text-center hover:underline" onClick={() => setZoom(1)} title="Fit width">
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="h-8 w-8 grid place-items-center rounded-md border border-outline-variant hover:bg-surface-container disabled:opacity-40"
            onClick={() => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] ?? 1)}
            disabled={zoom >= ZOOMS[ZOOMS.length - 1]}
            aria-label="Zoom in"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
          </button>
        </div>
        {!readOnly && (
          <>
            <div className="flex items-center gap-xs">
              <button
                type="button"
                className="h-8 w-8 grid place-items-center rounded-md border border-outline-variant hover:bg-surface-container disabled:opacity-40"
                onClick={undo}
                disabled={past.current.length === 0}
                aria-label="Undo"
                title="Undo (⌘/Ctrl + Z)"
              >
                <span className="material-symbols-outlined text-[18px]">undo</span>
              </button>
              <button
                type="button"
                className="h-8 w-8 grid place-items-center rounded-md border border-outline-variant hover:bg-surface-container disabled:opacity-40"
                onClick={redo}
                disabled={future.current.length === 0}
                aria-label="Redo"
                title="Redo (⇧⌘/Ctrl + Z)"
              >
                <span className="material-symbols-outlined text-[18px]">redo</span>
              </button>
            </div>
            <span className="text-caption text-on-surface-variant min-w-[6rem] text-right" aria-live="polite">
              {saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? "All changes saved" : ""}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-xs px-md py-xs bg-primary text-on-primary rounded-md text-body-md font-semibold hover:opacity-90 disabled:opacity-50"
              onClick={() => void save()}
              disabled={saving || !dirty}
              title="Save (⌘/Ctrl + S)"
            >
              <span className="material-symbols-outlined text-[18px]">save</span>
              Save
            </button>
          </>
        )}
      </div>

      {/* Notices */}
      {(props.readOnlyReason || props.forkedFrom || (!readOnly && props.sentCount > 0) || saveError) && (
        <div className="px-md py-xs space-y-xs border-b border-outline-variant bg-surface-container-low text-body-md">
          {props.readOnlyReason && <p>{props.readOnlyReason}</p>}
          {props.forkedFrom && (
            <p>
              Saved as v{version.version}. v{props.forkedFrom} had already been sent, so it stays exactly as it was.
            </p>
          )}
          {!readOnly && props.sentCount > 0 && (
            <p>
              {props.sentCount} agreement{props.sentCount === 1 ? " was" : "s were"} sent from v{version.version}. Saving
              changes creates v{version.version + 1}; sent agreements keep this layout.
            </p>
          )}
          {saveError && (
            <p className="text-error" role="alert">
              {saveError}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 grid lg:grid-cols-[13rem_minmax(0,1fr)_19rem]">
        {/* Palette */}
        <aside className="border-b lg:border-b-0 lg:border-r border-outline-variant p-sm space-y-sm overflow-y-auto bg-surface">
          {readOnly ? (
            <p className="text-body-md text-on-surface-variant">Read only.</p>
          ) : (
            <>
              <div>
                <span className="block text-label-sm text-on-surface-variant mb-xs">New fields are for</span>
                <div className="flex gap-xs" role="radiogroup" aria-label="New fields are for">
                  {SIGNER_ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={placeRole === r}
                      onClick={() => setPlaceRole(r)}
                      className={
                        "flex-1 h-8 rounded-md border text-body-md font-semibold " +
                        (placeRole === r ? ROLE_STYLES[r].chip : "border-outline-variant hover:bg-surface-container")
                      }
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-xs">
                {FIELD_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(FIELD_DRAG_MIME, t);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => addField(t, activePage)}
                    className="flex items-center gap-xs px-sm py-xs rounded-md border border-outline-variant text-body-md hover:bg-surface-container cursor-grab active:cursor-grabbing text-left"
                    title={`Drag onto a page, or click to add to page ${activePage}`}
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                      {FIELD_TYPE_ICONS[t]}
                    </span>
                    {FIELD_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
              <p className="text-caption text-on-surface-variant hidden lg:block">
                Drag a field onto the page, or click one to drop it on the page in view. Arrow keys nudge (Shift for
                bigger steps), Delete removes, ⌘/Ctrl+D duplicates.
              </p>
            </>
          )}
        </aside>

        {/* Pages */}
        <div ref={setScroller} className="overflow-auto bg-surface-container p-md max-h-[75vh] lg:max-h-none">
          {loadError ? (
            <div className="p-lg text-center text-body-md text-error" role="alert">
              {loadError}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-lg min-w-fit">
              {pages.map((geom, i) => (
                <BuilderPage
                  key={i}
                  pageNo={i + 1}
                  numPages={version.numPages}
                  geom={geom}
                  scale={scale}
                  renderScale={renderScale}
                  doc={doc}
                  scroller={scroller}
                  fields={byPage.get(i + 1) ?? []}
                  selected={selected}
                  readOnly={readOnly}
                  onPointerDownField={onPointerDownField}
                  onSelect={selectField}
                  onDropField={onDropField}
                />
              ))}
            </div>
          )}
        </div>

        {/* Properties + checks + list */}
        <aside className="border-t lg:border-t-0 lg:border-l border-outline-variant p-md space-y-lg overflow-y-auto bg-surface">
          {sel ? (
            <FieldProperties
              key={sel.uid}
              field={sel}
              pages={pages}
              readOnly={readOnly}
              keyTaken={(key) => fields.some((f) => f.uid !== sel.uid && f.key === key)}
              onChange={(patch, merge) => patchField(sel.uid, patch, merge)}
              onTypeChange={onTypeChange}
              onMergeKeyChange={onMergeKeyChange}
              onDuplicate={() => duplicateField(sel.uid)}
              onCopyToPages={(list) => {
                const copies = copyFieldToPages(sel, list, pages, keysExcept()).map(withUid);
                if (copies.length) change((fs) => [...fs, ...copies]);
                return copies.length;
              }}
              onDelete={() => deleteField(sel.uid)}
            />
          ) : (
            <p className="text-body-md text-on-surface-variant">
              {readOnly ? "Select a field to see its settings." : "Select a field to edit it, or add one from the left."}
            </p>
          )}

          {(errors.length > 0 || warnings.length > 0) && (
            <section className="space-y-xs">
              <button
                type="button"
                className="text-label-sm uppercase tracking-wider text-on-surface-variant flex items-center gap-xs"
                onClick={() => setShowChecks((v) => !v)}
                aria-expanded={showChecks || errors.length > 0}
              >
                Checks
                {errors.length > 0 && <span className="text-error">· {errors.length} to fix</span>}
                {warnings.length > 0 && <span>· {warnings.length} note{warnings.length === 1 ? "" : "s"}</span>}
              </button>
              {(showChecks || errors.length > 0) && (
                <ul className="space-y-xs text-body-md">
                  {errors.map((m, i) => (
                    <li key={`e${i}`} className="text-error flex gap-xs">
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">error</span>
                      {m}
                    </li>
                  ))}
                  {warnings.map((m, i) => (
                    <li key={`w${i}`} className="text-on-surface-variant flex gap-xs">
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">info</span>
                      {m}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="space-y-sm">
            <h4 className="text-label-sm uppercase tracking-wider text-on-surface-variant">
              All fields ({fields.length})
            </h4>
            <FieldList fields={fields} numPages={version.numPages} selected={selected} onSelect={scrollToField} />
          </section>
        </aside>
      </div>
    </div>
  );
}
