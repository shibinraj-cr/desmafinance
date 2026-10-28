import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fmtInvoiceNumber } from "./logic";

/**
 * The commission invoice as a PDF, laid out like DESMA's existing invoices:
 * yellow title band, logo, issuer block, the invoice number running up the
 * left margin, BILL TO beside the invoice details, a bordered table with a
 * yellow header, amount in words, the total box, bank details, signature, and
 * two yellow bands at the foot.
 *
 * Pure: everything it prints arrives in `InvoicePdfData` (the logo, font and
 * signature as bytes), so it runs the same in a route and in a test.
 */

export type InvoicePdfData = {
  number: string;
  invoiceDate: string; // YYYY-MM-DD
  paymentTerm: string;
  currency: string;
  billTo: { name: string; address: string; email: string | null; forLine: string | null };
  /** "compact" = program in the description; "detailed" = Student ID + Course columns. */
  layout: string;
  lines: Array<{
    description: string;
    studentId: string | null;
    courseName: string;
    intakeMonth: string;
    courseFee: number;
    commissionPct: number;
    /** Flat commission: the Commission% cell reads "Flat". */
    commissionFlat?: number | null;
    amount: number;
  }>;
  total: number;
  words: string;
  issuer: { name: string; address: string; regLine: string };
  bank: { accountName: string; currency: string; iban: string; bic: string; accountNo: string };
  signatory: { name: string; image: { bytes: Uint8Array; mime: string } | null };
  logoPng: Uint8Array | null;
  /** Unicode fallback font for names WinAnsi can't encode. */
  fallbackFont: Uint8Array | null;
  cancelled?: boolean;
};

const A4: [number, number] = [595.28, 841.89];
const [W, H] = A4;
const X0 = 70;
const X1 = W - 36;
const BAND = rgb(0.965, 0.796, 0.278);
const INK = rgb(0.2, 0.2, 0.2);
const SOFT = rgb(0.33, 0.33, 0.33);
const RULE = rgb(0.6, 0.6, 0.6);
const GOLD = rgb(0.93, 0.745, 0.21);
const ROW_H = 16;
const FOOTER_SPACE = 222;

type Fonts = { reg: PDFFont; bold: PDFFont; uni: PDFFont | null };

/** The font to draw `text` in: the template's Helvetica, or the Unicode fallback when Helvetica can't encode it. */
function fontFor(fonts: Fonts, text: string, bold: boolean): PDFFont {
  const f = bold ? fonts.bold : fonts.reg;
  try {
    f.encodeText(text);
    return f;
  } catch {
    return fonts.uni ?? f;
  }
}

function safe(fonts: Fonts, text: string, bold: boolean): { font: PDFFont; text: string } {
  const font = fontFor(fonts, text, bold);
  try {
    font.encodeText(text);
    return { font, text };
  } catch {
    // No fallback font available: drop what can't be drawn rather than fail the whole invoice.
    return { font, text: text.replace(/[^\x20-\x7E]/g, "?") };
  }
}

function draw(page: PDFPage, fonts: Fonts, text: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center"; maxWidth?: number } = {}) {
  const s = safe(fonts, text, !!opts.bold);
  let t = s.text;
  if (opts.maxWidth) {
    while (t.length > 1 && s.font.widthOfTextAtSize(t, size) > opts.maxWidth) t = t.slice(0, -2) + "…";
    if (s.font.widthOfTextAtSize(t, size) > opts.maxWidth) t = t.replace("…", "");
  }
  const w = s.font.widthOfTextAtSize(t, size);
  const dx = opts.align === "right" ? -w : opts.align === "center" ? -w / 2 : 0;
  page.drawText(t, { x: x + dx, y, size, font: s.font, color: opts.color ?? INK });
}

function wrap(fonts: Fonts, text: string, size: number, width: number, bold: boolean): string[] {
  const { font, text: t } = safe(fonts, text, bold);
  const out: string[] = [];
  for (const para of t.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function band(page: PDFPage, y: number, h: number) {
  page.drawRectangle({ x: 30, y, width: W - 60, height: h, color: BAND });
}

function cell(page: PDFPage, x: number, y: number, w: number, h: number, fill?: ReturnType<typeof rgb>) {
  page.drawRectangle({ x: x + 1, y: y + 1, width: w - 2, height: h - 2, borderColor: RULE, borderWidth: 0.6, color: fill });
}

function columns(layout: string): Array<{ title: string; w: number; key: keyof InvoicePdfData["lines"][number]; center: boolean }> {
  const total = X1 - X0;
  const spec: Array<[string, number, keyof InvoicePdfData["lines"][number], boolean]> =
    layout === "detailed"
      ? [
          ["DESCRIPTION", 0.23, "description", false],
          ["Student ID", 0.12, "studentId", false],
          ["Course", 0.13, "courseName", true],
          ["Intake Month", 0.13, "intakeMonth", false],
          ["Course Fee", 0.11, "courseFee", true],
          ["Commission%", 0.15, "commissionPct", true],
          ["Amount", 0.13, "amount", true],
        ]
      : [
          ["DESCRIPTION", 0.4, "description", false],
          ["Intake Month", 0.15, "intakeMonth", false],
          ["Course Fee", 0.13, "courseFee", true],
          ["Commission%", 0.15, "commissionPct", true],
          ["Amount", 0.17, "amount", true],
        ];
  return spec.map(([title, f, key, center]) => ({ title, w: total * f, key, center }));
}

function cellText(line: InvoicePdfData["lines"][number], key: keyof InvoicePdfData["lines"][number]): string {
  const v = line[key];
  if (key === "courseFee" || key === "amount") return fmtInvoiceNumber(Number(v));
  if (key === "commissionPct") return line.commissionFlat != null ? "Flat" : `${fmtInvoiceNumber(Number(v))}%`;
  return v == null ? "" : String(v);
}

function slashDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function buildInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${data.number}`);
  doc.setAuthor(data.issuer.name || "DesGro");
  doc.setCreator("DesGro");
  const fonts: Fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    uni: null,
  };
  if (data.fallbackFont) {
    doc.registerFontkit(fontkit);
    fonts.uni = await doc.embedFont(data.fallbackFont, { subset: false });
  }
  let logo: PDFImage | null = null;
  if (data.logoPng) logo = await doc.embedPng(data.logoPng).catch(() => null);
  let sig: PDFImage | null = null;
  if (data.signatory.image) {
    const { bytes, mime } = data.signatory.image;
    sig = await (mime === "image/jpeg" ? doc.embedJpg(bytes) : doc.embedPng(bytes)).catch(() => null);
  }

  const cols = columns(data.layout);
  const newPage = (first: boolean) => {
    const page = doc.addPage(A4);
    band(page, H - 64, 20);
    draw(page, fonts, "INVOICE", W / 2, H - 58, 13, { bold: true, align: "center" });
    // The invoice number running up the left margin, as on the template.
    const vs = safe(fonts, data.number, false);
    page.drawText(vs.text, { x: 50, y: first ? 360 : 520, size: 20, font: vs.font, color: GOLD, rotate: degrees(90) });
    if (data.cancelled) {
      page.drawText("CANCELLED", { x: 150, y: 330, size: 72, font: fonts.bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(30) });
    }
    return page;
  };

  // ── first page header ──
  let page = newPage(true);
  let y = H - 80;
  if (logo) {
    page.drawImage(logo, { x: X0, y: y - 76, width: 76, height: 76 });
  }
  y -= 96;
  draw(page, fonts, (data.issuer.name || "").toUpperCase(), X0, y, 12.5, { bold: true });
  y -= 15;
  for (const l of [data.issuer.address, data.issuer.regLine].flatMap((t) => (t ? wrap(fonts, t, 9.5, 300, false) : []))) {
    draw(page, fonts, l, X0, y, 9.5, { color: SOFT });
    y -= 13;
  }

  // ── bill-to and invoice details ──
  y -= 40;
  const topOfBlocks = y;
  draw(page, fonts, "BILL TO", X0, y, 10.5, { bold: true });
  y -= 14;
  draw(page, fonts, data.billTo.name, X0, y, 9.5, { color: rgb(0, 0, 0), maxWidth: 260 });
  y -= 13;
  const billLines = [
    ...(data.billTo.address ? data.billTo.address.split(/\r?\n/).flatMap((t) => wrap(fonts, t, 9.5, 260, false)) : []),
    ...(data.billTo.email ? [data.billTo.email] : []),
    ...(data.billTo.forLine ? [`FOR: ${data.billTo.forLine}`] : []),
  ];
  for (const l of billLines) {
    draw(page, fonts, l, X0, y, 9.5, { color: SOFT, maxWidth: 260 });
    y -= 13;
  }
  const labelX = 412;
  let my = topOfBlocks;
  for (const [label, value] of [
    ["Invoice No:", data.number],
    ["Invoice Date:", slashDate(data.invoiceDate)],
    ["Payment Term:", data.paymentTerm],
    ["Currency:", data.currency],
  ]) {
    draw(page, fonts, label, labelX, my, 9.5, { bold: true, align: "right" });
    draw(page, fonts, value, labelX + 5, my, 9.5, { color: SOFT, maxWidth: X1 - labelX - 5 });
    my -= 13;
  }
  y = Math.min(y, my) - 12;

  // ── table, paginated ──
  const drawHeader = (p: PDFPage, top: number) => {
    let x = X0;
    for (const c of cols) {
      cell(p, x, top - 15, c.w, 15, BAND);
      draw(p, fonts, c.title, c.center ? x + c.w / 2 : x + 4, top - 11, 8.5, { bold: true, align: c.center ? "center" : "left", maxWidth: c.w - 6 });
      x += c.w;
    }
    return top - 15;
  };
  let tableTop = y;
  y = drawHeader(page, y);
  const rows = data.lines;
  let i = 0;
  const outline = (p: PDFPage, top: number, bottom: number) =>
    p.drawRectangle({ x: X0, y: bottom, width: X1 - X0, height: top - bottom, borderColor: RULE, borderWidth: 0.6 });
  if (rows.length === 0) {
    cell(page, X0, y - ROW_H, X1 - X0, ROW_H);
    draw(page, fonts, "No lines", (X0 + X1) / 2, y - ROW_H + 5, 9, { align: "center", color: SOFT });
    y -= ROW_H;
  }
  while (i < rows.length) {
    const roomWithFooter = Math.floor((y - FOOTER_SPACE) / ROW_H);
    const roomFull = Math.floor((y - 90) / ROW_H);
    const remaining = rows.length - i;
    const take = remaining <= roomWithFooter ? remaining : Math.max(1, Math.min(roomFull, remaining));
    for (let k = 0; k < take; k++, i++) {
      const line = rows[i];
      let x = X0;
      for (const c of cols) {
        cell(page, x, y - ROW_H, c.w, ROW_H);
        const t = cellText(line, c.key);
        draw(page, fonts, t, c.center ? x + c.w / 2 : x + 4, y - ROW_H + 5, 9, { align: c.center ? "center" : "left", maxWidth: c.w - 6 });
        x += c.w;
      }
      y -= ROW_H;
    }
    outline(page, tableTop, y);
    if (i < rows.length) {
      page = newPage(false);
      y = H - 90;
      tableTop = y;
      y = drawHeader(page, y);
    }
  }
  if (rows.length === 0) outline(page, tableTop, y);

  // ── footer: words, total, bank, signature ──
  if (y < FOOTER_SPACE) {
    page = newPage(false);
    y = H - 90;
  }
  const boxW = 210;
  const bx = X1 - boxW;
  const labW = 110;
  cell(page, bx, y - 18, labW, 16);
  cell(page, bx + labW, y - 18, boxW - labW, 16);
  cell(page, bx, y - 38, labW, 20);
  cell(page, bx + labW, y - 38, boxW - labW, 20, BAND);
  page.drawRectangle({ x: bx, y: y - 39, width: boxW, height: 37, borderColor: RULE, borderWidth: 0.6 });
  draw(page, fonts, "Total", bx + labW - 4, y - 32, 10.5, { bold: true, align: "right" });
  draw(page, fonts, `${data.currency} ${fmtInvoiceNumber(data.total)}`, bx + labW + (boxW - labW) / 2, y - 33, 12.5, { bold: true, align: "center" });

  let ly = y - 14;
  draw(page, fonts, "Amount in Words:", X0, ly, 9, { color: SOFT });
  ly -= 15;
  for (const l of wrap(fonts, data.words, 10, bx - X0 - 16, true)) {
    draw(page, fonts, l, X0, ly, 10, { bold: true });
    ly -= 13;
  }
  ly -= 6;
  const short = (data.issuer.name || "us").replace(/\s+(LLC|L\.L\.C\.?|Ltd\.?|Limited|Pvt\.?\s*Ltd\.?|Private Limited)$/i, "");
  draw(page, fonts, `Thank you for choosing ${short}!`, X0, ly, 9.5, { color: SOFT });
  ly -= 30;

  const bankLines = [
    data.bank.accountName && data.bank.accountName,
    data.bank.currency && `ACCOUNT CURRENCY: ${data.bank.currency}`,
    data.bank.iban && `IBAN:${data.bank.iban}`,
    data.bank.bic && `BIC/SWIFT:${data.bank.bic}`,
    data.bank.accountNo && `ACCOUNT NUMBER:${data.bank.accountNo}`,
  ].filter(Boolean) as string[];
  if (bankLines.length) {
    draw(page, fonts, "Bank Account", X0, ly, 9, { color: SOFT });
    ly -= 12.5;
    for (const l of bankLines) {
      draw(page, fonts, l, X0, ly, 9, { color: SOFT });
      ly -= 12.5;
    }
  }

  // Signature block, right-aligned under the total.
  let sy = y - 70;
  if (data.issuer.name) draw(page, fonts, `For ${data.issuer.name}`, X1 - 10, sy, 9.5, { bold: true, align: "right" });
  sy -= 6;
  if (sig) {
    const scale = Math.min(120 / sig.width, 48 / sig.height, 1);
    const w = sig.width * scale;
    const h = sig.height * scale;
    page.drawImage(sig, { x: X1 - 30 - w, y: sy - h, width: w, height: h });
    sy -= h + 8;
  } else {
    sy -= 44;
  }
  if (data.signatory.name) draw(page, fonts, data.signatory.name, X1 - 10, sy, 9.5, { bold: true, align: "right" });

  for (const p of doc.getPages()) {
    band(p, 74, 18);
    band(p, 38, 18);
  }
  return doc.save();
}
