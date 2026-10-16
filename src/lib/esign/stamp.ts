import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { normalizeRotation } from "@/lib/esign/templates";

/**
 * Burn values into a template PDF.
 *
 * Runs unchanged in the browser (the send wizard's live preview) and on the
 * server (the `original.pdf` that is actually sent), so what staff preview is
 * byte-for-byte what the client receives. No Node imports here.
 *
 * Boxes arrive in display fractions (top-left origin, as drawn in the
 * builder). Each page's crop box and rotation are read from the PDF itself and
 * every point is mapped back into PDF user space, so rotated and cropped pages
 * land exactly where they were drawn. Text is drawn rotated with the page so it
 * reads upright on screen.
 */

export type StampText = {
  kind: "text";
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  alignment: "left" | "center" | "right";
  /** Wrap onto several lines (multi-line text fields). */
  multiline: boolean;
};

export type StampItem = StampText;

/** No text is drawn smaller than this, however long the value. */
export const MIN_FONT_SIZE = 6;
const PAD = 2;
const LINE_HEIGHT = 1.2;
const INK = rgb(0.07, 0.07, 0.09);

type Frame = { bx: number; by: number; bw: number; bh: number; rotate: 0 | 90 | 180 | 270; W: number; H: number };

function frameOf(page: PDFPage): Frame {
  const { x: bx, y: by, width: bw, height: bh } = page.getCropBox();
  const rotate = normalizeRotation(page.getRotation().angle);
  const sideways = rotate === 90 || rotate === 270;
  return { bx, by, bw, bh, rotate, W: sideways ? bh : bw, H: sideways ? bw : bh };
}

/**
 * A point on the displayed page (u right, v down, in points from the top-left)
 * → PDF user space. Inverse of the page's /Rotate (clockwise) over its crop box.
 */
export function displayToPdf(f: Pick<Frame, "bx" | "by" | "bw" | "bh" | "rotate">, u: number, v: number): { x: number; y: number } {
  switch (f.rotate) {
    case 90:
      return { x: f.bx + v, y: f.by + u };
    case 180:
      return { x: f.bx + f.bw - u, y: f.by + v };
    case 270:
      return { x: f.bx + f.bw - v, y: f.by + f.bh - u };
    default:
      return { x: f.bx + u, y: f.by + f.bh - v };
  }
}

/** Greedy word wrap at a font size; a single over-long word is left whole. */
export function wrapLines(text: string, maxWidth: number, widthOf: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && widthOf(next) > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Lay out one text box: the font size actually used and each line's position
 * in display points. Single lines shrink to fit the width; multi-line text
 * wraps and shrinks to fit the height. Neither goes below MIN_FONT_SIZE —
 * past that, text is allowed to overflow rather than be silently cut.
 */
export function layoutText(
  item: Pick<StampText, "x" | "y" | "w" | "h" | "text" | "fontSize" | "alignment" | "multiline">,
  frame: Pick<Frame, "W" | "H">,
  measure: { widthOf: (s: string, size: number) => number; capHeight: number },
): { size: number; lines: Array<{ text: string; u: number; v: number }> } {
  const dx = item.x * frame.W;
  const dy = item.y * frame.H;
  const dw = item.w * frame.W;
  const dh = item.h * frame.H;
  const inner = Math.max(1, dw - 2 * PAD);
  const text = item.multiline ? item.text : item.text.replace(/\s*\r?\n\s*/g, " ");

  let size = item.fontSize;
  let lines: string[];
  for (;;) {
    lines = item.multiline ? wrapLines(text, inner, (s) => measure.widthOf(s, size)) : [text];
    const fits = item.multiline
      ? lines.length * size * LINE_HEIGHT <= dh - 2 * PAD + 0.01 && lines.every((l) => measure.widthOf(l, size) <= inner)
      : measure.widthOf(text, size) <= inner;
    if (fits || size <= MIN_FONT_SIZE) break;
    size = Math.max(MIN_FONT_SIZE, size - 0.5);
  }

  const cap = measure.capHeight * size;
  // One line sits on the box's vertical centre; several start at the top.
  const firstBaseline = item.multiline && lines.length > 1 ? dy + PAD + cap : dy + dh / 2 + cap / 2;
  return {
    size,
    lines: lines.map((line, i) => {
      const width = measure.widthOf(line, size);
      const u = item.alignment === "center" ? dx + (dw - width) / 2 : item.alignment === "right" ? dx + dw - PAD - width : dx + PAD;
      return { text: line, u, v: firstBaseline + i * size * LINE_HEIGHT };
    }),
  };
}

function drawText(page: PDFPage, frame: Frame, font: PDFFont, capHeight: number, item: StampText) {
  if (!item.text.trim()) return;
  const { size, lines } = layoutText(item, frame, {
    widthOf: (s, sz) => font.widthOfTextAtSize(s, sz),
    capHeight,
  });
  for (const line of lines) {
    if (!line.text) continue;
    const at = displayToPdf(frame, line.u, line.v);
    page.drawText(line.text, { x: at.x, y: at.y, size, font, color: INK, rotate: degrees(frame.rotate) });
  }
}

/**
 * Stamp `items` onto a copy of `pdfBytes`. The font must cover every character
 * used (the app ships Noto Sans: Latin incl. accents, and ₹).
 */
export async function stampPdf(pdfBytes: Uint8Array, fontBytes: Uint8Array, items: StampItem[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false, updateMetadata: false });
  doc.registerFontkit(fontkit);
  // The whole font, not a subset: pdf-lib's subsetter scrambles glyphs with
  // Noto Sans ("Test Candidate" rendered as "C dd"), while the text layer still
  // read correctly — so only drawing the page shows it. See esign-stamp.test.ts.
  const font = await doc.embedFont(fontBytes, { subset: false });
  const metrics = fontkit.create(fontBytes);
  const capHeight = metrics.capHeight / metrics.unitsPerEm;
  const pages = doc.getPages();
  for (const item of items) {
    const page = pages[item.page - 1];
    if (!page) continue;
    drawText(page, frameOf(page), font, capHeight, item);
  }
  return doc.save();
}
