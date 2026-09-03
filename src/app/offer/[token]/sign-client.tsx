"use client";

import { useEffect, useRef, useState } from "react";
import { formatHiringDate } from "@/lib/hiring/core";

/**
 * The candidate's side of the offer: read it, type your name, draw your
 * signature, sign.
 *
 * The letter is rendered with dangerouslySetInnerHTML, and that is safe here
 * for a specific reason: the HTML was produced by `letterHtml()` on the server
 * from escaped values, and it is read back out of the envelope row unchanged.
 * No part of it comes from the person viewing this page.
 */
export function SignClient({
  token,
  documentHtml,
  signerName,
  expiresAt,
}: {
  token: string;
  documentHtml: string;
  signerName: string;
  expiresAt: string | null;
}) {
  const [typedName, setTypedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [state, setState] = useState<"idle" | "signing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  useSignaturePad(canvasRef, () => setHasDrawn(true));

  async function sign() {
    setState("signing");
    setError(null);
    const signature = hasDrawn ? (canvasRef.current?.toDataURL("image/png") ?? null) : null;

    const res = await fetch(`/api/offer/${token}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ typedName, signatureImageDataUrl: signature }),
    });

    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setState("idle");
      setError(d.message ?? "We could not record your signature. Please try again.");
      return;
    }
    const d = (await res.json()) as { pdfUrl: string | null };
    setPdfUrl(d.pdfUrl);
    setState("done");
  }

  if (state === "done") {
    return (
      <Page>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
          <h1 className="text-h2 text-on-surface">Signed — welcome aboard</h1>
          <p className="text-body-md text-on-surface-variant">
            Thank you, {typedName.trim()}. Your acceptance is recorded and our team has been
            notified. We will be in touch about your start.
          </p>
          {pdfUrl && (
            <p>
              <a className="underline text-primary text-body-md" href={pdfUrl}>
                Download your countersigned copy (PDF)
              </a>
            </p>
          )}
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <div className="space-y-lg">
        {expiresAt && (
          <p className="text-body-sm text-on-surface-variant">
            This offer is open for acceptance until{" "}
            <strong className="text-on-surface">{formatHiringDate(expiresAt)}</strong>.
          </p>
        )}

        <article
          className="offer-letter rounded-xl border border-outline-variant bg-surface-container-lowest p-lg"
          dangerouslySetInnerHTML={{ __html: documentHtml }}
        />

        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
          <h2 className="text-h3 text-on-surface">Sign</h2>

          {error && (
            <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
              {error}
            </div>
          )}

          <label className="block">
            <span className="block text-label-sm text-on-surface mb-xs">
              Type your full name <span className="text-error">*</span>
            </span>
            <input
              className="w-full min-h-[44px] px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={signerName}
              maxLength={120}
              autoComplete="name"
            />
          </label>

          <div>
            <span className="block text-label-sm text-on-surface mb-xs">Draw your signature</span>
            <canvas
              ref={canvasRef}
              width={600}
              height={160}
              aria-label="Signature area — draw with your finger or mouse"
              className="w-full h-40 rounded-lg border border-outline-variant bg-surface-container-lowest touch-none"
            />
            <div className="flex items-center justify-between mt-xs">
              <span className="text-caption text-on-surface-variant">
                Optional — your typed name is what signs this.
              </span>
              <button
                type="button"
                className="text-label-sm text-primary hover:underline"
                onClick={() => {
                  const ctx = canvasRef.current?.getContext("2d");
                  if (ctx && canvasRef.current) {
                    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                  }
                  setHasDrawn(false);
                }}
              >
                Clear
              </button>
            </div>
          </div>

          <label className="flex items-start gap-sm text-body-sm text-on-surface-variant">
            <input
              type="checkbox"
              className="mt-xs accent-primary h-4 w-4 flex-shrink-0"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I have read the offer above and I accept it. I understand that typing my name here has
              the same effect as signing on paper, and that the date, time, my IP address and my
              browser are recorded with it.
            </span>
          </label>

          <button
            type="button"
            className="w-full sm:w-auto min-h-[44px] px-xl rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-60"
            disabled={state === "signing" || !agreed || typedName.trim().length < 2}
            onClick={sign}
          >
            {state === "signing" ? "Recording…" : "Sign and accept"}
          </button>
        </section>
      </div>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-3xl px-md sm:px-lg py-xl">{children}</div>
    </div>
  );
}

/** A plain pointer-events signature pad — no library, no dependency. */
function useSignaturePad(
  ref: React.RefObject<HTMLCanvasElement>,
  onDraw: () => void,
) {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1A1A1A";

    let drawing = false;

    // The canvas is laid out wider than its backing store, so pointer
    // coordinates have to be scaled or the line lands away from the finger.
    function pos(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas!.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas!.height,
      };
    }

    function down(e: PointerEvent) {
      drawing = true;
      canvas!.setPointerCapture(e.pointerId);
      const { x, y } = pos(e);
      ctx!.beginPath();
      ctx!.moveTo(x, y);
      onDraw();
    }
    function move(e: PointerEvent) {
      if (!drawing) return;
      e.preventDefault();
      const { x, y } = pos(e);
      ctx!.lineTo(x, y);
      ctx!.stroke();
    }
    function up() {
      drawing = false;
    }

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", up);
    };
  }, [ref, onDraw]);
}
