import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
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

describe("signature images and ticks land in their boxes", () => {
  let canvasOk = true;
  try {
    require.resolve("@napi-rs/canvas");
  } catch {
    canvasOk = false;
  }

  async function render(bytes: Uint8Array) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
    const { createCanvas } = await import("@napi-rs/canvas");
    const page = await (await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise).getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const w = Math.ceil(viewport.width);
    const h = Math.ceil(viewport.height);
    const c = createCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
    const { data } = ctx.getImageData(0, 0, w, h);
    /** Share of dark pixels in a box given in page fractions. */
    const ink = (fx: number, fy: number, fw: number, fh: number) => {
      let dark = 0;
      let total = 0;
      for (let y = Math.floor(fy * h); y < Math.floor((fy + fh) * h); y++) {
        for (let x = Math.floor(fx * w); x < Math.floor((fx + fw) * w); x++) {
          total++;
          if (data[(y * w + x) * 4] < 100) dark++;
        }
      }
      return dark / Math.max(1, total);
    };
    return ink;
  }

  async function blackPng(): Promise<Uint8Array> {
    const { createCanvas } = await import("@napi-rs/canvas");
    const c = createCanvas(200, 100);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 200, 100);
    return new Uint8Array(c.toBuffer("image/png"));
  }

  for (const rotate of [0, 90]) {
    it.skipIf(!canvasOk)(`an image fills its box on a ${rotate}° page and nothing else`, async () => {
      const doc = await PDFDocument.create();
      const p = doc.addPage([600, 800]);
      if (rotate) p.setRotation(degrees(rotate));
      const box = { page: 1, x: 0.3, y: 0.6, w: 0.4, h: 0.2 }; // same 2:1 shape as the PNG on a 0° page
      const ink = await render(await stampPdf(await doc.save(), FONT, [{ kind: "image", ...box, png: await blackPng() }]));
      // The image is fitted (aspect kept), so its centre is always inside the box.
      expect(ink(box.x + box.w * 0.4, box.y + box.h * 0.4, box.w * 0.2, box.h * 0.2)).toBeGreaterThan(0.9);
      // Well outside the box stays white.
      expect(ink(0.02, 0.02, 0.2, 0.2)).toBe(0);
      expect(ink(0.75, 0.05, 0.2, 0.3)).toBe(0);
    });
  }

  it.skipIf(!canvasOk)("a ticked checkbox draws inside its box", async () => {
    const box = { page: 1, x: 0.5, y: 0.5, w: 0.05, h: 0.04 };
    const ink = await render(await stampPdf(await blankPage(), FONT, [{ kind: "check", ...box }]));
    expect(ink(box.x, box.y, box.w, box.h)).toBeGreaterThan(0.05);
    expect(ink(box.x - 0.1, box.y - 0.1, 0.05, 0.05)).toBe(0);
  });
});
