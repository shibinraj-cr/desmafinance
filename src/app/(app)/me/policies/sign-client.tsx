"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function SignClient({ policyId }: { policyId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!open) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, [open]);

  function pos(e: React.MouseEvent | React.TouchEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    if ("touches" in e) {
      const t = e.touches[0];
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function start_(e: React.MouseEvent | React.TouchEvent) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function end() {
    drawing.current = false;
  }
  function clear() {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
  }

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Type your full name to confirm.");
      return;
    }
    const c = canvasRef.current;
    const signatureImage = c ? c.toDataURL("image/png") : null;
    const res = await fetch(`/api/me/policies/${policyId}/acknowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signatureName: name, signatureImage }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "sign failed");
      return;
    }
    setOpen(false);
    start(() => router.refresh());
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-md px-md py-sm rounded bg-primary text-on-primary font-bold"
      >
        Read &amp; e-sign
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-md"
          onClick={() => setOpen(false)}
        >
          <div className="bg-surface rounded-xl shadow-2xl max-w-md w-full p-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h3 mb-md">E-sign acknowledgement</h3>
            <p className="text-on-surface-variant text-label-sm mb-md">
              I confirm that I have read and understood this policy and agree to comply with it.
            </p>
            <label className="flex flex-col gap-xs mb-md">
              <span className="text-caption text-on-surface-variant">Full name</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <p className="text-caption text-on-surface-variant mb-xs">Signature</p>
            <canvas
              ref={canvasRef}
              width={400}
              height={140}
              className="w-full border border-outline-variant bg-white rounded touch-none"
              onMouseDown={start_}
              onMouseMove={move}
              onMouseUp={end}
              onMouseLeave={end}
              onTouchStart={start_}
              onTouchMove={move}
              onTouchEnd={end}
            />
            <div className="flex justify-between mt-sm">
              <button onClick={clear} className="text-label-sm underline text-on-surface-variant">
                Clear
              </button>
              <span className="text-caption text-on-surface-variant">Sign with finger / mouse</span>
            </div>
            {error && <p className="text-red-700 text-label-sm mt-sm">{error}</p>}
            <div className="flex justify-end gap-sm mt-md">
              <button onClick={() => setOpen(false)} className="px-md py-sm rounded border border-outline-variant">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={pending}
                className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
              >
                Sign &amp; submit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
