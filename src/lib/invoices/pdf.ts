import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/**
 * A candidate invoice as a PDF, laid out like DESMA's own invoices: yellow
 * title band, logo, company block, the number and "INVOICE" running up the
 * left margin, BILL TO beside the invoice details, a bordered table with a
 * yellow header, the tax rows and total box, amount in words, bank details,
 * signature, and the yellow bands at the foot. Three layouts, one per sample:
 *
 *   "dipl-dom"  DESCRIPTION | QTY | Amount | HSN | TOTAL, then CGST/SGST or IGST
 *   "dipl-exp"  DESCRIPTION | Intake Month | Amount, total "624.08(41300)"
 *   "dllc"      DESCRIPTION | QTY | Amount | TOTAL, total "AED1,400.00"
 *
 * Pure: everything printed arrives in the argument (logo, font and signature
 * as bytes), so a route and a test render the same file. The result is
 * stored when the invoice is issued and never rendered again.
 */

export type InvoiceLayout = "dipl-dom" | "dipl-exp" | "dllc";

export type InvoicePdfInput = {
  layout: InvoiceLayout;
  title: string;
  number: string;
  invoiceDate: string; // YYYY-MM-DD
  paymentTerm: string;
  currency: string;
  issuer: { legalName: string; headerLines: string; signFor: string; thanksLine: string; signatoryName: string };
  billTo: { name: string; lines: string[] };
  description: string;
  intakeMonth: string | null;
  hsn: string | null;
  /** In `currency`: the taxable value on a domestic DIPL invoice, else the total. */
  amount: number;
  tax: { cgst: number; sgst: number; igst: number; ratePct: number } | null;
  total: number;
  /** Rupees received; printed in brackets after a foreign-currency export total. */
  receivedInr: number;
  words: string;
  note: string;
  bankLines: string[];
  /** Export: the Letter of Undertaking line. */
  lutLine: string | null;
  placeOfSupply: string | null;
  signature: { bytes: Uint8Array; mime: string } | null;
  logoPng: Uint8Array | null;
  /** Noto Sans: the ₹ sign and names Helvetica can't encode. */
  unicodeFont: Uint8Array | null;
};

const A4: [number, number] = [595.28, 841.89];
const [W, H] = A4;
const X0 = 76;
const X1 = W - 40;
const BAND = rgb(0.988, 0.8, 0.165);
const INK = rgb(0.2, 0.2, 0.2);
const SOFT = rgb(0.3, 0.3, 0.3);
const RULE = rgb(0.5, 0.5, 0.5);
const GOLD = rgb(0.96, 0.75, 0.1);
const GREY = rgb(0.55, 0.55, 0.55);

/**
 * Helvetica for text. Noto Sans is embedded (whole) only when something on
 * the invoice can't be written in Helvetica, which for passport names is rare.
 * The ₹ sign is drawn as a vector shape traced from Noto's own glyph: a
 * subsetted Noto drops that glyph's outline, and the whole font is 600 KB.
 */
type Fonts = { reg: PDFFont; bold: PDFFont; uni: PDFFont | null; rupee: { svg: string; advance: number; upm: number } | null };
type Color = ReturnType<typeof rgb>;

function canEncode(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Helvetica when it can draw the text, else Noto Sans, else Helvetica with the odd characters replaced. */
function pick(fonts: Fonts, text: string, bold: boolean): { font: PDFFont; text: string } {
  const f = bold ? fonts.bold : fonts.reg;
  if (canEncode(f, text)) return { font: f, text };
  if (fonts.uni && canEncode(fonts.uni, text)) return { font: fonts.uni, text };
  return { font: f, text: text.replace(/[^\x20-\x7E]/g, "?") };
}

type DrawOpts = { bold?: boolean; color?: Color; align?: "left" | "right" | "center"; maxWidth?: number };

function textWidth(fonts: Fonts, text: string, size: number, bold = false): number {
  const p = pick(fonts, text, bold);
  return p.font.widthOfTextAtSize(p.text, size);
}

function draw(page: PDFPage, fonts: Fonts, text: string, x: number, y: number, size: number, o: DrawOpts = {}) {
  if (!text) return;
  const p = pick(fonts, text, !!o.bold);
  let t = p.text;
  if (o.maxWidth) {
    while (t.length > 1 && p.font.widthOfTextAtSize(t, size) > o.maxWidth) t = t.slice(0, -2) + "…";
    if (p.font.widthOfTextAtSize(t, size) > o.maxWidth) t = t.replace("…", "");
  }
  const w = p.font.widthOfTextAtSize(t, size);
  const dx = o.align === "right" ? -w : o.align === "center" ? -w / 2 : 0;
  page.drawText(t, { x: x + dx, y, size, font: p.font, color: o.color ?? INK });
}

function wrap(fonts: Fonts, text: string, size: number, width: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(fonts, next, size, bold) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function box(page: PDFPage, x: number, y: number, w: number, h: number, fill?: Color) {
  page.drawRectangle({ x: x + 1, y: y + 1, width: w - 2, height: h - 2, borderColor: RULE, borderWidth: 0.8, color: fill });
}

function band(page: PDFPage, y: number, h: number) {
  page.drawRectangle({ x: 40, y, width: W - 80, height: h, color: BAND });
}

// ── money ────────────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** 29000 → "29,000"; 2610 → "2,610.00" with `fixed`; Indian grouping. */
export function inr(n: number, fixed = false): string {
  const v = r2(n);
  return v.toLocaleString("en-IN", {
    minimumFractionDigits: fixed || !Number.isInteger(v) ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Line amounts on the DLLC and export samples: "1400", "624.08", no separators. */
export function plain(n: number): string {
  const v = r2(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** The total box text for a layout. */
export function totalText(input: Pick<InvoicePdfInput, "layout" | "currency" | "total" | "receivedInr">): string {
  if (input.currency === "INR") return inr(input.total);
  if (input.layout === "dllc") {
    return `${input.currency}${r2(input.total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${plain(input.total)}(${plain(input.receivedInr)})`;
}

/** "₹" at the left of a cell, the figure at its right, as on the D/DIPL sample. */
function rupeeCell(page: PDFPage, fonts: Fonts, x: number, w: number, y: number, figure: string, size: number, bold = false) {
  if (fonts.rupee) {
    page.drawSvgPath(fonts.rupee.svg, {
      x: x + 5,
      y,
      scale: size / fonts.rupee.upm,
      color: INK,
      ...(bold ? { borderColor: INK, borderWidth: 0.5 } : {}),
    });
  } else {
    draw(page, fonts, "Rs.", x + 5, y, size, { bold });
  }
  draw(page, fonts, figure, x + w - 5, y, size, { bold, align: "right" });
}

/** Every string the invoice prints, to decide whether Noto Sans must be embedded. */
function printedTexts(input: InvoicePdfInput): string[] {
  return [
    input.title,
    input.number,
    input.paymentTerm,
    input.currency,
    ...Object.values(input.issuer),
    input.billTo.name,
    ...input.billTo.lines,
    input.description,
    input.intakeMonth ?? "",
    input.hsn ?? "",
    input.words,
    input.note,
    ...input.bankLines,
    input.lutLine ?? "",
    input.placeOfSupply ?? "",
  ];
}

type GlyphFont = {
  unitsPerEm: number;
  glyphForCodePoint(cp: number): { advanceWidth: number; path: { scale(x: number, y: number): { toSVG(): string } } };
};

function rupeeShape(fontBytes: Uint8Array): Fonts["rupee"] {
  try {
    const font = (fontkit as unknown as { create(b: Uint8Array): GlyphFont }).create(fontBytes);
    const g = font.glyphForCodePoint(0x20b9);
    // Font units are y-up; SVG (which drawSvgPath expects) is y-down.
    const svg = g.path.scale(1, -1).toSVG();
    return svg ? { svg, advance: g.advanceWidth, upm: font.unitsPerEm } : null;
  } catch {
    return null;
  }
}

function slashDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ── the page ─────────────────────────────────────────────────────────────────

export async function buildCandidateInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${input.number}`);
  doc.setAuthor(input.issuer.legalName || "DesGro");
  doc.setCreator("DesGro");
  const fonts: Fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    uni: null,
    rupee: null,
  };
  if (input.unicodeFont) {
    fonts.rupee = rupeeShape(input.unicodeFont);
    const lines = printedTexts(input).flatMap((t) => t.split(/\r?\n/));
    if (lines.some((t) => !canEncode(fonts.reg, t) || !canEncode(fonts.bold, t))) {
      doc.registerFontkit(fontkit);
      fonts.uni = await doc.embedFont(input.unicodeFont, { subset: false });
    }
  }
  let logo: PDFImage | null = null;
  if (input.logoPng) logo = await doc.embedPng(input.logoPng).catch(() => null);
  let sig: PDFImage | null = null;
  if (input.signature) {
    const { bytes, mime } = input.signature;
    sig = await (mime === "image/jpeg" ? doc.embedJpg(bytes) : doc.embedPng(bytes)).catch(() => null);
  }

  const page = doc.addPage(A4);
  band(page, H - 118, 20);
  draw(page, fonts, input.title.toUpperCase(), W / 2, H - 112, 13, { bold: true, align: "center" });

  // Number and "INVOICE" up the left margin.
  const vertical = (text: string, y: number, color: Color) => {
    const p = pick(fonts, text, false);
    page.drawText(p.text, { x: 62, y, size: 19, font: p.font, color, rotate: degrees(90) });
  };
  vertical(input.number, 420, GOLD);
  vertical("INVOICE", 302, GREY);

  // Company block.
  let y = H - 130;
  if (logo) page.drawImage(logo, { x: X0, y: y - 78, width: 78, height: 78 });
  y -= 98;
  draw(page, fonts, input.issuer.legalName.toUpperCase(), X0, y, 12, { bold: true, maxWidth: X1 - X0 });
  y -= 13.5;
  for (const l of wrap(fonts, input.issuer.headerLines, 8.6, X1 - X0 - 120)) {
    draw(page, fonts, l, X0, y, 8.6, { color: SOFT });
    y -= 11.2;
  }

  // Bill to, and the invoice details on the right.
  y -= 30;
  const top = y;
  draw(page, fonts, "BILL TO", X0, y, 9.5, { bold: true });
  y -= 13;
  draw(page, fonts, input.billTo.name, X0, y, 8.6, { color: rgb(0, 0, 0), maxWidth: 230 });
  y -= 12;
  for (const l of input.billTo.lines.flatMap((t) => wrap(fonts, t, 8.6, 230))) {
    draw(page, fonts, l, X0, y, 8.6, { color: SOFT });
    y -= 11.2;
  }
  const details: Array<[string, string]> = [
    ["Invoice No:", input.number],
    ["Invoice Date:", slashDate(input.invoiceDate)],
    ["Payment Term:", input.paymentTerm],
  ];
  if (input.layout === "dipl-exp") details.push(["Currency:", input.currency]);
  if (input.placeOfSupply) details.push(["Place of Supply:", input.placeOfSupply]);
  let dy = top;
  const labelX = 392;
  for (const [label, value] of details) {
    draw(page, fonts, label, labelX, dy, 8.6, { bold: true, align: "right" });
    draw(page, fonts, value, labelX + 4, dy, 8.6, { color: SOFT, maxWidth: X1 - labelX - 4 });
    dy -= 11.5;
  }
  y = Math.min(y, dy) - 40;

  // ── table ──
  const total = X1 - X0;
  const cols =
    input.layout === "dipl-dom"
      ? [
          { t: "DESCRIPTION", w: 0.52 },
          { t: "QTY", w: 0.06 },
          { t: "Amount", w: 0.17 },
          { t: "HSN", w: 0.1 },
          { t: "TOTAL", w: 0.15 },
        ]
      : input.layout === "dllc"
        ? [
            { t: "DESCRIPTION", w: 0.6 },
            { t: "QTY", w: 0.06 },
            { t: "Amount", w: 0.17 },
            { t: "TOTAL", w: 0.17 },
          ]
        : [
            { t: "DESCRIPTION", w: 0.55 },
            { t: "Intake Month", w: 0.25 },
            { t: "Amount", w: 0.2 },
          ];
  const xs: number[] = [];
  let cx = X0;
  for (const c of cols) {
    xs.push(cx);
    cx += c.w * total;
  }
  const cw = (i: number) => cols[i].w * total;
  const headH = 14;
  const rowH = 32;
  cols.forEach((c, i) => {
    box(page, xs[i], y - headH, cw(i), headH, BAND);
    draw(page, fonts, c.t, i === 0 ? xs[i] + 4 : xs[i] + cw(i) / 2, y - 10.5, 8.6, {
      bold: true,
      align: i === 0 ? "left" : "center",
    });
  });
  y -= headH;
  const rowY = y - rowH;
  const textY = rowY + rowH / 2 - 3;
  cols.forEach((_, i) => box(page, xs[i], rowY, cw(i), rowH));
  const descLines = wrap(fonts, input.description, 9, cw(0) - 8).slice(0, 2);
  descLines.forEach((l, k) => draw(page, fonts, l, xs[0] + 4, textY + (descLines.length === 2 ? 5.5 - k * 11 : 0), 9));
  if (input.layout === "dipl-dom") {
    draw(page, fonts, "1", xs[1] + cw(1) / 2, textY, 9, { align: "center" });
    rupeeCell(page, fonts, xs[2], cw(2), textY, inr(input.amount), 9);
    draw(page, fonts, input.hsn ?? "", xs[3] + cw(3) / 2, textY, 9, { align: "center" });
    rupeeCell(page, fonts, xs[4], cw(4), textY, inr(input.amount), 9);
  } else if (input.layout === "dllc") {
    draw(page, fonts, "1", xs[1] + cw(1) / 2, textY, 9, { align: "center" });
    draw(page, fonts, plain(input.amount), xs[2] + cw(2) - 5, textY, 9, { align: "right" });
    draw(page, fonts, plain(input.amount), xs[3] + cw(3) - 5, textY, 9, { align: "right" });
  } else {
    draw(page, fonts, input.intakeMonth ?? "", xs[1] + cw(1) / 2, textY, 9, { align: "center" });
    const amt = input.currency === "INR" ? inr(input.amount) : plain(input.amount);
    if (input.currency === "INR") rupeeCell(page, fonts, xs[2], cw(2), textY, amt, 9);
    else draw(page, fonts, amt, xs[2] + cw(2) / 2, textY, 9, { align: "center" });
  }
  page.drawRectangle({ x: X0, y: rowY, width: total, height: rowH + headH, borderColor: RULE, borderWidth: 1.2 });
  y = rowY;

  // ── under the table: tax rows and the total box on the right ──
  // "Total" sits in the Amount column (Intake Month on export); the yellow value box fills the rest.
  const labelIdx = input.layout === "dipl-exp" ? 1 : 2;
  const totalsX = xs[labelIdx];
  const labelW = cw(labelIdx);
  const valueX = totalsX + labelW;
  const valueW = X1 - valueX;
  let ty = y;
  const taxRows: Array<[string, number]> = [];
  if (input.tax) {
    if (input.tax.igst > 0) taxRows.push(["IGST", input.tax.igst]);
    else {
      taxRows.push(["CGST", input.tax.cgst]);
      taxRows.push(["SGST", input.tax.sgst]);
    }
  }
  const pct = input.tax ? (input.tax.igst > 0 ? input.tax.ratePct : input.tax.ratePct / 2) : 0;
  for (const [label, value] of taxRows) {
    const h = 16;
    box(page, totalsX, ty - h, labelW, h);
    if (input.layout === "dipl-dom") {
      box(page, xs[3], ty - h, cw(3), h);
      box(page, xs[4], ty - h, cw(4), h);
      draw(page, fonts, label, xs[3] - 5, ty - 11.5, 8.6, { align: "right" });
      draw(page, fonts, `${pct}%`, xs[3] + cw(3) / 2, ty - 11.5, 8.6, { align: "center" });
      rupeeCell(page, fonts, xs[4], cw(4), ty - 11.5, inr(value, true), 8.6);
    }
    ty -= h;
  }
  const totalH = 22;
  box(page, totalsX, ty - totalH, labelW, totalH);
  box(page, valueX, ty - totalH, valueW, totalH, BAND);
  draw(page, fonts, "Total", valueX - 5, ty - 15, 10.5, { bold: true, align: "right" });
  if (input.currency === "INR") rupeeCell(page, fonts, valueX, valueW, ty - 15.5, totalText(input), 12, true);
  else draw(page, fonts, totalText(input), valueX + valueW - 5, ty - 15.5, 11.5, { bold: true, align: "right", maxWidth: valueW - 8 });
  const tableBottom = ty - totalH;
  page.drawRectangle({ x: totalsX, y: tableBottom, width: X1 - totalsX, height: y - tableBottom, borderColor: RULE, borderWidth: 1.2 });

  // ── left of the totals: note, amount in words, thanks ──
  let ly = y - 8;
  const leftW = totalsX - X0 - 10;
  for (const l of wrap(fonts, input.note, 6.6, leftW)) {
    draw(page, fonts, l, X0, ly, 6.6, { color: SOFT });
    ly -= 8;
  }
  ly -= 6;
  draw(page, fonts, "Amount in Words:", X0, ly, 8.6, { color: SOFT });
  ly -= 13;
  for (const l of wrap(fonts, input.words, 9.5, leftW, true)) {
    draw(page, fonts, l, X0, ly, 9.5, { bold: true });
    ly -= 12;
  }
  ly = Math.min(ly, tableBottom) - 14;
  if (input.issuer.thanksLine) {
    draw(page, fonts, input.issuer.thanksLine, X0, ly, 8.6, { color: SOFT });
    ly -= 26;
  }

  // ── bank details, export declaration ──
  if (input.bankLines.length) {
    draw(page, fonts, "Bank Account", X0, ly, 8.6, { color: SOFT });
    ly -= 11.2;
    for (const l of input.bankLines.flatMap((t) => wrap(fonts, t, 8.6, 300))) {
      draw(page, fonts, l, X0, ly, 8.6, { color: SOFT });
      ly -= 11.2;
    }
  }
  if (input.lutLine) {
    ly -= 6;
    for (const l of wrap(fonts, input.lutLine, 7.6, X1 - X0)) {
      draw(page, fonts, l, X0, ly, 7.6, { color: SOFT });
      ly -= 9.5;
    }
  }

  // ── signature, right-aligned below the bank block ──
  let sy = Math.min(ly - 10, tableBottom - 150);
  draw(page, fonts, input.issuer.signFor, X1 - 8, sy, 8.6, { bold: true, align: "right" });
  sy -= 4;
  if (sig) {
    const scale = Math.min(110 / sig.width, 40 / sig.height, 1);
    const w = sig.width * scale;
    const h = sig.height * scale;
    page.drawImage(sig, { x: X1 - 40 - w, y: sy - h, width: w, height: h });
    sy -= h + 9;
  } else {
    sy -= 40;
  }
  draw(page, fonts, input.issuer.signatoryName, X1 - 8, sy, 8.6, { bold: true, align: "right" });

  const footY = Math.min(sy - 24, 112);
  band(page, footY, 17);
  if (input.layout !== "dipl-dom") band(page, footY - 40, 17);
  return doc.save();
}

/**
 * A copy of an issued file with a big diagonal word (CANCELLED, PREVIEW) and
 * a line of small print at the top of every page. The original stays
 * byte-for-byte as it was.
 */
export async function stampWatermark(original: Uint8Array, word: string, note: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const red = rgb(0.8, 0.12, 0.12);
  const safeNote = note.replace(/[^\x20-\x7E]/g, "?");
  const size = 78;
  const w = bold.widthOfTextAtSize(word, size);
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    // Centre the rotated word on the page: start below-left by half its run at 30°.
    const x = width / 2 - (w / 2) * Math.cos(Math.PI / 6);
    const y = height / 2 - (w / 2) * Math.sin(Math.PI / 6);
    p.drawText(word, { x, y, size, font: bold, color: red, opacity: 0.2, rotate: degrees(30) });
    p.drawText(safeNote, { x: 40, y: height - 40, size: 9, font: reg, color: red, maxWidth: width - 80 });
  }
  return doc.save();
}
