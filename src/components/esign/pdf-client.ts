"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { STREAM_LIMIT_BYTES, rangeChunks } from "@/lib/esign/templates";

/**
 * Browser-side PDF loading for the agreement builder (and, later, the signer
 * page).
 *
 * pdf.js is imported lazily so only pages that show a PDF pay for it. Its
 * worker is a static file copied into public/pdfjs/ by
 * scripts/copy-pdfjs-worker.mjs: same-origin, so the site CSP allows it
 * (script-src 'self'), where a CDN or blob: worker would be blocked. The
 * filename carries the version so the worker always matches this API.
 * The legacy build is used for older mobile browsers.
 */

type PdfJs = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((mod) => {
    const lib = mod as unknown as PdfJs;
    lib.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker-${lib.version}.min.mjs`;
    return lib;
  });
  return pdfjs;
}

/**
 * Fetch a PDF's bytes from one of our file routes. Files over the single-
 * response limit come down in byte ranges, a few at a time, and each part is
 * checked against the Content-Range the server reports.
 */
export async function fetchPdfBytes(url: string, size: number): Promise<Uint8Array> {
  if (size <= STREAM_LIMIT_BYTES) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`The PDF could not be loaded (${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
  }

  const out = new Uint8Array(size);
  const queue = rangeChunks(size);
  const worker = async () => {
    for (let part = queue.shift(); part; part = queue.shift()) {
      let at = part.start;
      while (at <= part.end) {
        const res = await fetch(url, { cache: "no-store", headers: { range: `bytes=${at}-${part.end}` } });
        if (res.status !== 206) throw new Error(`The PDF could not be loaded (${res.status}).`);
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
        if (!m || Number(m[1]) !== at || Number(m[3]) !== size) throw new Error("The PDF came back in the wrong pieces.");
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength !== Number(m[2]) - at + 1) throw new Error("The PDF came back incomplete.");
        out.set(buf, at);
        at += buf.byteLength;
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const lib = await loadPdfJs();
  return lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
}
