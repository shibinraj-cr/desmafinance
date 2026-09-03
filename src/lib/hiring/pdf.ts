/**
 * A minimal PDF writer, enough for one document type: the countersigned offer
 * letter.
 *
 * Written by hand rather than pulled in as a dependency because the two real
 * options both cost more than they are worth here — a headless browser does not
 * run on this platform's serverless functions without bundling Chromium, and a
 * general PDF library is a large dependency for one page of text. What this
 * produces is a genuine, openable PDF: Helvetica, A4, wrapped text, correct
 * xref offsets. It is plain by design; the on-screen letter carries the
 * letterhead, and this is the artefact that gets archived.
 *
 * Encoding: PDF's standard Helvetica is WinAnsi, which has no rupee sign, so
 * callers pass amounts already written as "INR 4.50 lakh". `sanitize()` is the
 * backstop — a character that cannot be encoded becomes "?" rather than
 * corrupting the byte offsets the xref table depends on.
 */

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const LINE_HEIGHT = 15;
const BODY_SIZE = 10.5;
const HEADING_SIZE = 15;

export type PdfBlock =
  | { type: "heading"; text: string }
  | { type: "subheading"; text: string }
  | { type: "text"; text: string }
  | { type: "bullet"; text: string }
  | { type: "spacer" }
  | { type: "rule" };

type Line = { text: string; bold: boolean; size: number; indent: number; rule?: boolean };

/** Render blocks to a PDF file as a Buffer. */
export function renderPdf(blocks: PdfBlock[]): Buffer {
  const lines = layout(blocks);
  const pages = paginate(lines);
  return assemble(pages);
}

function layout(blocks: PdfBlock[]): Line[] {
  const usable = PAGE_WIDTH - MARGIN * 2;
  const out: Line[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        out.push({ text: "", bold: false, size: BODY_SIZE, indent: 0 });
        for (const t of wrap(block.text, HEADING_SIZE, usable, true)) {
          out.push({ text: t, bold: true, size: HEADING_SIZE, indent: 0 });
        }
        break;
      case "subheading":
        out.push({ text: "", bold: false, size: BODY_SIZE, indent: 0 });
        for (const t of wrap(block.text, BODY_SIZE + 1, usable, true)) {
          out.push({ text: t, bold: true, size: BODY_SIZE + 1, indent: 0 });
        }
        break;
      case "text":
        for (const t of wrap(block.text, BODY_SIZE, usable, false)) {
          out.push({ text: t, bold: false, size: BODY_SIZE, indent: 0 });
        }
        break;
      case "bullet": {
        const wrapped = wrap(block.text, BODY_SIZE, usable - 14, false);
        wrapped.forEach((t, i) => {
          out.push({ text: i === 0 ? `-  ${t}` : `   ${t}`, bold: false, size: BODY_SIZE, indent: 14 });
        });
        break;
      }
      case "spacer":
        out.push({ text: "", bold: false, size: BODY_SIZE, indent: 0 });
        break;
      case "rule":
        out.push({ text: "", bold: false, size: BODY_SIZE, indent: 0, rule: true });
        break;
    }
  }
  return out;
}

function paginate(lines: Line[]): Line[][] {
  const perPage = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);
  const pages: Line[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}

/**
 * Helvetica's average advance width is close enough to 0.5em for wrapping a
 * business letter; the alternative is embedding the font's full width table for
 * a document nobody sets ragged-right by hand anyway.
 */
function textWidth(text: string, size: number): number {
  return text.length * size * 0.5;
}

function wrap(text: string, size: number, maxWidth: number, _bold: boolean): string[] {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (textWidth(next, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Keep to what WinAnsi can carry; anything else becomes "?". */
export function sanitize(text: string): string {
  return text
    .replace(/₹/g, "INR ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    .replace(/₨/g, "INR ")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7e]/g, "?");
}

/** PDF string escaping: backslash, and the parens that delimit a string. */
export function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function contentStream(lines: Line[]): string {
  const parts: string[] = [];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    if (line.rule) {
      parts.push(
        `0.7 w 0.6 0.6 0.6 RG ${MARGIN} ${(y + 4).toFixed(2)} m ${(PAGE_WIDTH - MARGIN).toFixed(2)} ${(y + 4).toFixed(2)} l S`,
      );
    } else if (line.text) {
      parts.push(
        "BT",
        `/${line.bold ? "F2" : "F1"} ${line.size} Tf`,
        `${(MARGIN + line.indent).toFixed(2)} ${y.toFixed(2)} Td`,
        `(${escapePdfText(line.text)}) Tj`,
        "ET",
      );
    }
    y -= LINE_HEIGHT;
  }
  return parts.join("\n");
}

function assemble(pages: Line[][]): Buffer {
  const objects: string[] = [];
  const pageObjNumbers: number[] = [];

  // 1 catalog, 2 pages, then per page: page object + content stream.
  // Fonts come last so their numbers are known up front.
  const firstPageObj = 3;
  const fontRegular = firstPageObj + pages.length * 2;
  const fontBold = fontRegular + 1;

  for (let i = 0; i < pages.length; i++) pageObjNumbers.push(firstPageObj + i * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] =
    `<< /Type /Pages /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;

  pages.forEach((lines, i) => {
    const pageNum = firstPageObj + i * 2;
    const contentNum = pageNum + 1;
    const stream = contentStream(lines);
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
      `/Contents ${contentNum} 0 R >>`;
    objects[contentNum] =
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  objects[fontRegular] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[fontBold] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  // Byte offsets are what make an xref table valid, so the file is assembled as
  // latin1 bytes and measured as it goes.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = Buffer.byteLength(pdf, "latin1");
    pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  const size = objects.length;
  pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) {
    pdf += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}
