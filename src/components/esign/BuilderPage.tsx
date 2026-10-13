"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { mergeKeyLabel } from "@/lib/esign/merge-keys";
import { FIELD_TYPE_ICONS, FIELD_TYPE_LABELS, type TemplateField } from "@/lib/esign/template-fields";
import type { PageGeometry } from "@/lib/esign/templates";

export type BuilderField = TemplateField & { uid: string };

/** Drag-and-drop payload type for palette → page drops. */
export const FIELD_DRAG_MIME = "application/x-desgro-esign-field";

export const ROLE_STYLES: Record<string, { box: string; ring: string; chip: string }> = {
  Client: {
    box: "border-sky-600 bg-sky-400/20 text-sky-950",
    ring: "ring-sky-600",
    chip: "bg-sky-100 text-sky-900 border-sky-300",
  },
  DESMA: {
    box: "border-violet-600 bg-violet-400/20 text-violet-950",
    ring: "ring-violet-600",
    chip: "bg-violet-100 text-violet-900 border-violet-300",
  },
};

export function fieldCaption(f: TemplateField): string {
  return f.label || mergeKeyLabel(f.mergeKey) || FIELD_TYPE_LABELS[f.type];
}

type PageProps = {
  pageNo: number;
  numPages: number;
  geom: PageGeometry;
  /** CSS pixels per PDF point right now. */
  scale: number;
  /** The scale the canvas is drawn at — lags `scale` while zooming. */
  renderScale: number;
  doc: PDFDocumentProxy | null;
  scroller: HTMLElement | null;
  fields: BuilderField[];
  selected: string | null;
  readOnly: boolean;
  onPointerDownField: (e: React.PointerEvent, uid: string, mode: "move" | "resize") => void;
  onSelect: (uid: string | null, page: number) => void;
  onDropField: (type: string, page: number, at: { x: number; y: number }) => void;
};

/** One PDF page: the rendered canvas with the field boxes laid over it. */
export const BuilderPage = memo(function BuilderPage(props: PageProps) {
  const { pageNo, numPages, geom, scale, renderScale, doc, scroller, fields, selected, readOnly } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);
  const width = geom.w * scale;
  const height = geom.h * scale;

  // Draw a page only once it is near the viewport; long templates stay cheap.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), {
      root: scroller,
      rootMargin: "800px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [scroller, visible]);

  useEffect(() => {
    if (!doc || !visible) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(pageNo);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (geom.w * renderScale) / base.width });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      task = page.render({ canvasContext: ctx, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      await task.promise;
      if (!cancelled) setDrawn(true);
    })().catch((err: unknown) => {
      if (!cancelled && (err as { name?: string })?.name !== "RenderingCancelledException") setFailed(true);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, visible, pageNo, geom.w, renderScale]);

  function fractionAt(clientX: number, clientY: number) {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
  }

  return (
    <div className="flex flex-col items-center gap-xs">
      <div
        ref={wrapRef}
        data-page={pageNo}
        className="relative bg-white shadow-md select-none"
        style={{ width, height }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || e.target === canvasRef.current) props.onSelect(null, pageNo);
        }}
        onDragOver={(e) => {
          if (!readOnly && e.dataTransfer.types.includes(FIELD_DRAG_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          const type = e.dataTransfer.getData(FIELD_DRAG_MIME);
          if (readOnly || !type) return;
          e.preventDefault();
          props.onDropField(type, pageNo, fractionAt(e.clientX, e.clientY));
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
        {!drawn && (
          <div className="absolute inset-0 grid place-items-center text-caption text-on-surface-variant">
            {failed ? "This page could not be drawn." : "Loading page…"}
          </div>
        )}
        {fields.map((f) => (
          <FieldBox
            key={f.uid}
            field={f}
            heightPx={f.h * height}
            selected={f.uid === selected}
            readOnly={readOnly}
            onPointerDown={props.onPointerDownField}
            onSelect={(uid) => props.onSelect(uid, pageNo)}
          />
        ))}
      </div>
      <div className="text-caption text-on-surface-variant">
        Page {pageNo} of {numPages}
      </div>
    </div>
  );
});

function FieldBox({
  field: f,
  heightPx,
  selected,
  readOnly,
  onPointerDown,
  onSelect,
}: {
  field: BuilderField;
  heightPx: number;
  selected: boolean;
  readOnly: boolean;
  onPointerDown: (e: React.PointerEvent, uid: string, mode: "move" | "resize") => void;
  onSelect: (uid: string) => void;
}) {
  const style = ROLE_STYLES[f.role] ?? ROLE_STYLES.Client;
  const fontPx = Math.max(8, Math.min(13, heightPx * 0.55));
  const caption = fieldCaption(f);
  return (
    <div
      data-uid={f.uid}
      role="button"
      tabIndex={0}
      aria-label={`${caption}, ${FIELD_TYPE_LABELS[f.type]}, ${f.role}${selected ? ", selected" : ""}`}
      aria-pressed={selected}
      className={
        "absolute border rounded-[2px] outline-none " +
        style.box +
        (f.mergeKey ? " border-dashed" : "") +
        (selected ? " ring-2 ring-offset-1 z-10 " + style.ring : "") +
        (readOnly ? " cursor-pointer" : " cursor-move")
      }
      style={{
        left: `${f.x * 100}%`,
        top: `${f.y * 100}%`,
        width: `${f.w * 100}%`,
        height: `${f.h * 100}%`,
        fontSize: fontPx,
        lineHeight: 1.1,
        touchAction: "none",
      }}
      onPointerDown={(e) => (readOnly ? onSelect(f.uid) : onPointerDown(e, f.uid, "move"))}
      onFocus={() => onSelect(f.uid)}
    >
      {/* Clipped inner layer, so the resize handle can sit over the corner. */}
      <div className="absolute inset-0 flex items-center gap-[2px] px-[3px] overflow-hidden">
        {heightPx >= 12 && (
          <span className="material-symbols-outlined shrink-0" style={{ fontSize: fontPx + 1 }} aria-hidden="true">
            {FIELD_TYPE_ICONS[f.type]}
          </span>
        )}
        {heightPx >= 10 && <span className="truncate font-semibold">{caption}</span>}
        {f.required && <span className="shrink-0 font-bold" aria-hidden="true">*</span>}
      </div>
      {selected && !readOnly && (
        <span
          className={"absolute right-0 bottom-0 w-3 h-3 translate-x-1/2 translate-y-1/2 rounded-full bg-white border-2 cursor-nwse-resize " + style.box.split(" ")[0]}
          style={{ touchAction: "none" }}
          onPointerDown={(e) => onPointerDown(e, f.uid, "resize")}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
