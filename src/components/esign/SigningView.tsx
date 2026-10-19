"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BuilderPage } from "@/components/esign/BuilderPage";
import { fetchPdfBytes, openPdf } from "@/components/esign/pdf-client";
import { SignatureModal } from "@/components/esign/SignatureModal";
import { FIELD_TYPE_LABELS, mustFill, type TemplateField } from "@/lib/esign/template-fields";
import type { PageGeometry } from "@/lib/esign/templates";

/**
 * The signing screen, shared by the client's public page and DESMA staff's
 * in-app page: the agreement as it stands, this signer's boxes laid over it as
 * inputs, a "next field" guide, the consent statement, and sign / decline.
 */

export type SigningProps = {
  mode: "public" | "internal";
  title: string;
  signer: { name: string; email: string | null; phone: string | null; role: string };
  /** This signer's boxes (CRM-filled ones are already printed in the file). */
  fields: TemplateField[];
  /** Boxes for signers after this one, shown as outlines. */
  later: Array<{ page: number; x: number; y: number; w: number; h: number; role: string }>;
  pages: PageGeometry[];
  fileUrl: string;
  fileSize: number;
  completeUrl: string;
  declineUrl: string;
  today: string;
};

const CONSENT = "I agree that my electronic signature is the legal equivalent of my handwritten signature.";

function orderOf(f: TemplateField) {
  return f.page * 10 + f.y + f.x / 100;
}

export function SigningView(p: SigningProps) {
  const sorted = useMemo(() => [...p.fields].sort((a, b) => orderOf(a) - orderOf(b)), [p.fields]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of p.fields) {
      if (f.type === "name") v[f.key] = p.signer.name;
      else if (f.type === "email") v[f.key] = p.signer.email ?? "";
      else if (f.type === "phone") v[f.key] = p.signer.phone ?? "";
      else if (f.type === "date") v[f.key] = p.today;
      else if (f.type === "checkbox") v[f.key] = "false";
    }
    return v;
  });
  const [images, setImages] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [shareLocation, setShareLocation] = useState(false);
  const [modal, setModal] = useState<TemplateField | null>(null);
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "signed" | "partially_signed" | "declined">(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    fetchPdfBytes(p.fileUrl, p.fileSize)
      .then(openPdf)
      .then((d) => {
        opened = d;
        if (cancelled) return void d.destroy();
        setDoc(d);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : "The agreement could not be loaded."));
    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [p.fileUrl, p.fileSize]);

  useEffect(() => {
    if (!box) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);

  const isFilled = (f: TemplateField) =>
    f.type === "signature" || f.type === "initial" ? !!images[f.key] : f.type === "checkbox" ? values[f.key] === "true" : !!(values[f.key] ?? "").trim();
  const required = sorted.filter(mustFill);
  const filledRequired = required.filter(isFilled).length;
  const ready = filledRequired === required.length && consent;

  function goNext() {
    const next = sorted.find((f) => mustFill(f) && !isFilled(f)) ?? sorted.find((f) => !isFilled(f));
    if (!next) return;
    const el = document.querySelector<HTMLElement>(`[data-field="${next.key}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    if (next.type === "signature" || next.type === "initial") setTimeout(() => setModal(next), 350);
    else setTimeout(() => el?.querySelector<HTMLElement>("input,textarea,select,button")?.focus(), 350);
  }

  function adopt(field: TemplateField, png: string, all: boolean) {
    setImages((prev) => {
      const next = { ...prev, [field.key]: png };
      if (all) for (const f of p.fields) if (f.type === field.type) next[f.key] = png;
      return next;
    });
    setModal(null);
  }

  async function location(): Promise<{ lat: number; lng: number } | null> {
    if (!shareLocation || !("geolocation" in navigator)) return null;
    return new Promise((ok) =>
      navigator.geolocation.getCurrentPosition(
        (pos) => ok({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => ok(null),
        { timeout: 8000, maximumAge: 60000 },
      ),
    );
  }

  async function finish() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(p.completeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values, images, consent, location: await location() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? "Signing did not go through. Try again.");
      setDone(data.status === "signed" ? "signed" : "partially_signed");
      scrollRef.current?.scrollTo({ top: 0 });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <DoneView state={done} mode={p.mode} title={p.title} fileUrl={p.fileUrl} />;

  const maxW = Math.max(...p.pages.map((g) => g.w));
  const scale = Math.max(260, Math.min(width - 16, 900)) / maxW;
  const byPage = (n: number) => sorted.filter((f) => f.page === n);

  return (
    <div className="pb-48">
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200 px-3 py-2 flex items-center gap-3">
        <div className="text-sm text-gray-700 flex-1">
          <b>
            {filledRequired} of {required.length}
          </b>{" "}
          required {required.length === 1 ? "box" : "boxes"} done
        </div>
        <button type="button" onClick={goNext} disabled={filledRequired === required.length && sorted.every(isFilled)} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          Next field ↓
        </button>
      </div>

      <div ref={(el) => { setBox(el); scrollRef.current = el; }} className="px-2 py-3">
        {loadError ? (
          <p className="p-6 text-center text-red-700">{loadError}</p>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {p.pages.map((geom, i) => (
              <BuilderPage
                key={i}
                pageNo={i + 1}
                numPages={p.pages.length}
                geom={geom}
                scale={scale}
                renderScale={scale}
                doc={doc}
                scroller={null}
                fields={[]}
                selected={null}
                readOnly
                onPointerDownField={() => {}}
                onSelect={() => {}}
                onDropField={() => {}}
                overlay={
                  <>
                    {p.later
                      .filter((l) => l.page === i + 1)
                      .map((l, j) => (
                        <div
                          key={`later-${j}`}
                          className="absolute border border-dashed border-gray-400 bg-gray-100/60 text-[10px] text-gray-500 flex items-center justify-center pointer-events-none"
                          style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` }}
                        >
                          For {l.role}
                        </div>
                      ))}
                    {byPage(i + 1).map((f) => (
                      <FieldInput
                        key={f.key}
                        field={f}
                        heightPx={f.h * geom.h * scale}
                        value={values[f.key] ?? ""}
                        image={images[f.key]}
                        filled={isFilled(f)}
                        onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                        onSign={() => setModal(f)}
                      />
                    ))}
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="mx-auto max-w-3xl space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{CONSENT}</span>
          </label>
          {p.mode === "public" && (
            <label className="flex items-start gap-2 text-xs text-gray-600">
              <input type="checkbox" className="mt-0.5" checked={shareLocation} onChange={(e) => setShareLocation(e.target.checked)} />
              <span>Add my location to the signing record (optional)</span>
            </label>
          )}
          {error && (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button type="button" onClick={finish} disabled={!ready || busy} className="flex-1 rounded-lg bg-[#F5C518] py-3 font-bold text-[#1A1A1A] disabled:opacity-40">
              {busy ? "Signing…" : "Sign and finish"}
            </button>
            <button type="button" onClick={() => setDeclining(true)} className="text-sm text-gray-600 underline">
              Decline
            </button>
          </div>
          {!ready && (
            <p className="text-xs text-gray-500">
              {filledRequired < required.length ? "Fill every box marked * — use Next field to find them." : "Tick the box above to agree."}
            </p>
          )}
        </div>
      </div>

      {modal && (
        <SignatureModal
          kind={modal.type === "initial" ? "initial" : "signature"}
          signerName={p.signer.name}
          onClose={() => setModal(null)}
          onDone={(png, all) => adopt(modal, png, all)}
        />
      )}
      {declining && <DeclineModal url={p.declineUrl} onClose={() => setDeclining(false)} onDeclined={() => setDone("declined")} />}
    </div>
  );
}

function FieldInput({
  field: f,
  heightPx,
  value,
  image,
  filled,
  onChange,
  onSign,
}: {
  field: TemplateField;
  heightPx: number;
  value: string;
  image: string | undefined;
  filled: boolean;
  onChange: (v: string) => void;
  onSign: () => void;
}) {
  const style: React.CSSProperties = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` };
  const req = mustFill(f);
  const ring = filled ? "border-emerald-600 bg-emerald-50/40" : req ? "border-amber-500 bg-amber-100/60" : "border-sky-500 bg-sky-50/60";
  const font = Math.max(10, Math.min(16, heightPx * 0.6));
  const label = f.label || FIELD_TYPE_LABELS[f.type];
  const common = `absolute border-2 rounded-sm ${ring}`;

  if (f.type === "signature" || f.type === "initial") {
    return (
      <button type="button" data-field={f.key} onClick={onSign} className={`${common} flex items-center justify-center`} style={style} aria-label={`${f.type === "initial" ? "Add initials" : "Sign"}: ${label}`}>
        {/* Small boxes get a larger invisible tap area, so they are easy to hit on a phone. */}
        <span className="absolute -inset-3" aria-hidden="true" />
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="font-bold text-amber-900 whitespace-nowrap leading-none overflow-hidden" style={{ fontSize: Math.max(8, Math.min(16, heightPx * 0.55)) }}>
            {f.type === "initial" ? "Initial" : "Sign here"}
            {req ? " *" : ""}
          </span>
        )}
      </button>
    );
  }
  if (f.type === "checkbox") {
    return (
      <button
        type="button"
        data-field={f.key}
        role="checkbox"
        aria-checked={value === "true"}
        aria-label={label}
        onClick={() => onChange(value === "true" ? "false" : "true")}
        className={`${common} flex items-center justify-center font-bold leading-none`}
        style={{ ...style, fontSize: Math.max(10, heightPx * 0.8) }}
      >
        <span className="absolute -inset-3" aria-hidden="true" />
        {value === "true" ? "✓" : ""}
      </button>
    );
  }
  if (f.type === "radio" || f.type === "selection") {
    return (
      <div data-field={f.key} className={common} style={style}>
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-full w-full bg-transparent px-1 outline-none" style={{ fontSize: font }}>
          <option value="">{req ? "Choose… *" : "Choose…"}</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (f.type === "textarea") {
    return (
      <div data-field={f.key} className={common} style={style}>
        <textarea aria-label={label} placeholder={`${label}${req ? " *" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} className="h-full w-full resize-none bg-transparent px-1 outline-none" style={{ fontSize: font }} />
      </div>
    );
  }
  return (
    <div data-field={f.key} className={common} style={style}>
      <input
        aria-label={label}
        placeholder={`${label}${req ? " *" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={f.type === "phone" ? "tel" : f.type === "email" ? "email" : undefined}
        className="h-full w-full bg-transparent px-1 outline-none"
        style={{ fontSize: font, textAlign: f.alignment }}
      />
    </div>
  );
}

function DeclineModal({ url, onClose, onDeclined }: { url: string; onClose: () => void; onDeclined: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? "That did not go through. Try again.");
      onDeclined();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Decline to sign">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3">
        <h3 className="text-lg font-bold">Decline to sign?</h3>
        <p className="text-sm text-gray-600">The agreement will be stopped and DESMA will be told. Tell us briefly why.</p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} className="w-full rounded-lg border border-gray-300 p-2" aria-label="Reason" />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 font-semibold">
            Back
          </button>
          <button type="button" onClick={submit} disabled={busy || !reason.trim()} className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-40">
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

function DoneView({ state, mode, title, fileUrl }: { state: "signed" | "partially_signed" | "declined"; mode: "public" | "internal"; title: string; fileUrl: string }) {
  if (state === "declined") {
    return (
      <div className="mx-auto max-w-lg p-6 text-center space-y-3">
        <h2 className="text-2xl font-bold">You declined this agreement</h2>
        <p className="text-gray-700">DESMA has been told and will be in touch.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-lg p-6 text-center space-y-4">
      <div className="text-5xl" aria-hidden="true">
        ✅
      </div>
      <h2 className="text-2xl font-bold">{mode === "internal" ? "Signed — handed to the client" : "Thank you — you have signed"}</h2>
      <p className="text-gray-700">
        {state === "signed"
          ? `Everyone has signed the ${title}. The signed copy, with its certificate, has been emailed to you.`
          : mode === "internal"
            ? `DESMA's part of the ${title} is done. The client has been sent their link.`
            : `Your signature is recorded. You will get the final signed copy by email once everyone has signed.`}
      </p>
      <a href={fileUrl} target="_blank" rel="noreferrer" className="inline-block rounded-lg bg-[#F5C518] px-5 py-3 font-bold text-[#1A1A1A]">
        {state === "signed" ? "Download the signed copy" : "Download your copy"}
      </a>
    </div>
  );
}
