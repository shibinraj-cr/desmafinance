import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { stampPdf } from "@/lib/esign/stamp";

// Its own file on purpose: unpdf (used by esign-stamp.test.ts) registers a
// global pdf.js 5 worker that a pdfjs-dist 4 document would pick up and reject.

const FONT = new Uint8Array(readFileSync("public/fonts/esign/NotoSans-Regular.ttf"));

async function blankPage() {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  return doc.save();
}
/**
 * Render a stamped page with pdf.js and count separate glyph shapes on the
 * text's line. Reading the text layer is not enough: pdf-lib's font subsetter
 * once produced a PDF whose text layer said "Test Candidate" while the page
 * showed "C dd". Skipped where the native canvas package is unavailable.
 */
describe("stamped text is actually drawn", () => {
  let canvasOk = true;
  try {
    require.resolve("@napi-rs/canvas");
  } catch {
    canvasOk = false;
  }

  it.skipIf(!canvasOk)("every glyph of a name shows up on the rendered page", async () => {
    const text = "Test Candidate ₹2,00,000";
    const bytes = await stampPdf(await blankPage(), FONT, [
      { kind: "text", page: 1, x: 0.1, y: 0.1, w: 0.8, h: 0.05, text, fontSize: 14, alignment: "left", multiline: false },
    ]);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
    const { createCanvas } = await import("@napi-rs/canvas");
    const page = await (await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise).getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const img = { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) };
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, img.width, img.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
    // The box spans y 10–15% of the page; count runs of inked columns across it.
    const top = Math.floor(img.height * 0.1);
    const h = Math.ceil(img.height * 0.05);
    const { data } = ctx.getImageData(0, top, img.width, h);
    let runs = 0;
    let inRun = false;
    for (let x = 0; x < img.width; x++) {
      let ink = false;
      for (let y = 0; y < h && !ink; y++) {
        const i = (y * img.width + x) * 4;
        ink = data[i + 3] > 0 && data[i] < 128;
      }
      if (ink && !inRun) runs++;
      inRun = ink;
    }
    const glyphs = text.replace(/\s/g, "").length; // 21
    expect(runs).toBeGreaterThanOrEqual(Math.floor(glyphs * 0.8));
  });
});
