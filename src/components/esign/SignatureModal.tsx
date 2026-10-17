"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Capture a signature or initials: draw (smoothed), type in a handwriting
 * font, or upload an image. Whatever the method, the result is a PNG cropped
 * to the ink, small enough to send, with a transparent background.
 */

export const HANDWRITING_FONTS = [
  { family: "DesgroDancing", label: "Flowing", file: "/fonts/esign/DancingScript-Regular.ttf" },
  { family: "DesgroVibes", label: "Elegant", file: "/fonts/esign/GreatVibes-Regular.ttf" },
] as const;

const MAX_PNG_BYTES = 380 * 1024;

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 4);
}

/** Crop a canvas to its ink and return a PNG data URL (or null if it is empty). */
export function croppedPng(source: HTMLCanvasElement): string | null {
  const ctx = source.getContext("2d")!;
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  for (let scale = 1; scale >= 0.25; scale /= 1.5) {
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round((maxX - minX + 1) * scale));
    out.height = Math.max(1, Math.round((maxY - minY + 1) * scale));
    out.getContext("2d")!.drawImage(source, minX, minY, maxX - minX + 1, maxY - minY + 1, 0, 0, out.width, out.height);
    const url = out.toDataURL("image/png");
    if ((url.length * 3) / 4 <= MAX_PNG_BYTES) return url;
  }
  return null;
}

type Tab = "draw" | "type" | "upload";

export function SignatureModal({
  kind,
  signerName,
  onClose,
  onDone,
}: {
  kind: "signature" | "initial";
  signerName: string;
  onClose: () => void;
  /** `applyToAll`: use this for every box of the same kind. */
  onDone: (png: string, applyToAll: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("draw");
  const [typed, setTyped] = useState(kind === "initial" ? initialsOf(signerName) : signerName);
  const [font, setFont] = useState<string>(HANDWRITING_FONTS[0].family);
  const [fontsReady, setFontsReady] = useState(false);
  const [applyToAll, setApplyToAll] = useState(true);
  const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const uploadRef = useRef<HTMLCanvasElement | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const W = kind === "initial" ? 360 : 720;
  const H = 240;

  // Handwriting fonts for the "type" tab, loaded from our own origin.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      HANDWRITING_FONTS.map(async (f) => {
        const face = new FontFace(f.family, `url(${f.file})`);
        await face.load();
        document.fonts.add(face);
      }),
    )
      .then(() => !cancelled && setFontsReady(true))
      .catch(() => !cancelled && setFontsReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Drawing with quadratic smoothing between pointer samples.
  useEffect(() => {
    const canvas = drawRef.current;
    if (!canvas || tab !== "draw") return;
    const ctx = canvas.getContext("2d")!;
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    let pts: Array<{ x: number; y: number }> = [];
    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
    };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pts = [pos(e)];
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = "#111827";
      ctx.fill();
      setDrawn(true);
    };
    const move = (e: PointerEvent) => {
      if (!pts.length) return;
      e.preventDefault();
      pts.push(pos(e));
      if (pts.length < 3) return;
      const [a, b, c] = pts.slice(-3);
      const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const m2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
      ctx.beginPath();
      ctx.moveTo(m1.x, m1.y);
      ctx.quadraticCurveTo(b.x, b.y, m2.x, m2.y);
      ctx.stroke();
    };
    const up = () => {
      pts = [];
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [tab]);

  function clearDrawing() {
    const c = drawRef.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  }

  function typedCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    let size = kind === "initial" ? 120 : 110;
    ctx.font = `${size}px ${font}`;
    while (ctx.measureText(typed).width > W - 40 && size > 24) {
      size -= 4;
      ctx.font = `${size}px ${font}`;
    }
    ctx.fillStyle = "#111827";
    ctx.textBaseline = "middle";
    ctx.fillText(typed, 20, H / 2);
    return c;
  }

  async function onUpload(file: File | null) {
    setError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return setError("Use a PNG or JPG image.");
    if (file.size > 5 * 1024 * 1024) return setError("That image is over 5 MB.");
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((ok, no) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => no(new Error("unreadable"));
        i.src = url;
      });
      const c = document.createElement("canvas");
      const scale = Math.min(1, W / img.width, H / img.height);
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // Paper photos: make near-white pixels transparent so only the ink is kept.
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i] > 225 && d.data[i + 1] > 225 && d.data[i + 2] > 225) d.data[i + 3] = 0;
      }
      ctx.putImageData(d, 0, 0);
      uploadRef.current = c;
      setUploaded(c.toDataURL("image/png"));
    } catch {
      setError("That image could not be read.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function finish() {
    setError(null);
    let png: string | null = null;
    if (tab === "draw") png = drawRef.current && drawn ? croppedPng(drawRef.current) : null;
    else if (tab === "type") png = typed.trim() ? croppedPng(typedCanvas()) : null;
    else png = uploadRef.current ? croppedPng(uploadRef.current) : null;
    if (!png) return setError(tab === "draw" ? "Draw your signature in the box first." : tab === "type" ? "Type your name first." : "Choose an image first.");
    onDone(png, applyToAll);
  }

  const label = kind === "initial" ? "initials" : "signature";
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-md"
      role="dialog"
      aria-modal="true"
      aria-label={`Add your ${label}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl p-md space-y-md shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Add your {label}</h3>
          <button type="button" onClick={onClose} className="text-sm text-gray-600 hover:underline">
            Close
          </button>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1" role="tablist">
          {(["draw", "type", "upload"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={"flex-1 rounded-md py-2 text-sm font-semibold " + (tab === t ? "bg-white shadow" : "text-gray-600")}
            >
              {t === "draw" ? "Draw" : t === "type" ? "Type" : "Upload"}
            </button>
          ))}
        </div>

        {tab === "draw" && (
          <div className="space-y-2">
            <canvas
              ref={drawRef}
              width={W}
              height={H}
              className="w-full rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 touch-none"
              style={{ aspectRatio: `${W} / ${H}` }}
              aria-label={`Draw your ${label} here`}
            />
            <div className="flex justify-between text-sm text-gray-600">
              <span>Sign with your finger or mouse.</span>
              <button type="button" onClick={clearDrawing} className="font-semibold hover:underline">
                Clear
              </button>
            </div>
          </div>
        )}

        {tab === "type" && (
          <div className="space-y-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value.slice(0, 60))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
              aria-label={kind === "initial" ? "Your initials" : "Your name"}
            />
            <div className="grid grid-cols-2 gap-2">
              {HANDWRITING_FONTS.map((f) => (
                <button
                  key={f.family}
                  type="button"
                  onClick={() => setFont(f.family)}
                  aria-pressed={font === f.family}
                  className={"rounded-lg border p-3 text-left " + (font === f.family ? "border-sky-600 ring-2 ring-sky-200" : "border-gray-300")}
                >
                  <span className="block text-xs text-gray-500">{f.label}</span>
                  <span className="block truncate text-3xl" style={{ fontFamily: fontsReady ? f.family : "cursive" }}>
                    {typed || "Your name"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "upload" && (
          <div className="space-y-2">
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => onUpload(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
            <p className="text-sm text-gray-600">A clear photo or scan of your {label} on white paper works best.</p>
            {uploaded && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={uploaded} alt={`Uploaded ${label}`} className="max-h-32 rounded border border-gray-200 bg-gray-50 p-2" />
            )}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
          Use this for every {label} box in this agreement
        </label>
        {error && (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <button type="button" onClick={finish} className="w-full rounded-lg bg-[#F5C518] py-3 font-bold text-[#1A1A1A] hover:opacity-90">
          Adopt and sign
        </button>
      </div>
    </div>
  );
}
