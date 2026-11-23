/**
 * Candidate invoices: the pure rules. Client-safe, no database.
 *
 * One invoice per payment received: an approved Revenue ledger row into an
 * invoicing bank (Axis, HDFC, Wio) becomes one invoice. Numbers are assigned
 * on issue, per series and financial year. The PDF is stored once and never
 * re-rendered (see server.ts).
 *
 *   Axis/HDFC + DOM → DESMA International Pvt Ltd (DIPL), INR, GST worked back
 *                     out of the amount received: same state as the issuer →
 *                     CGST + SGST, any other state → IGST. The total always
 *                     equals the bank credit.
 *   Axis/HDFC + EXP → DIPL export invoice, no GST, optionally in the foreign
 *                     currency the candidate paid in, with the INR alongside.
 *   Wio             → DESMA International LLC (DLLC), in AED, no tax.
 */

import { gstStateOfGstin } from "./gst-states";

export const GST_RATE_PCT = 18;

export const INVOICE_KINDS = ["DOM", "EXP"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_ENTITIES = ["DIPL", "DLLC"] as const;
export type InvoiceEntityCode = (typeof INVOICE_ENTITIES)[number];

export const ENTITY_LABEL: Record<InvoiceEntityCode, string> = {
  DIPL: "DESMA International Pvt Ltd (India)",
  DLLC: "DESMA International LLC (UAE)",
};

/** The banks invoices can be issued for, and the company each one belongs to by default. */
export const INVOICE_BANKS = ["Axis Bank", "HDFC Bank", "Wio Bank"] as const;
export type InvoiceBank = (typeof INVOICE_BANKS)[number];
export const DEFAULT_BANK_ENTITY: Record<InvoiceBank, InvoiceEntityCode> = {
  "Axis Bank": "DIPL",
  "HDFC Bank": "DIPL",
  "Wio Bank": "DLLC",
};

export function isInvoiceBank(mode: string | null | undefined): mode is InvoiceBank {
  return (INVOICE_BANKS as readonly string[]).includes(mode ?? "");
}

/** Number series. DLLC has no export variant: its invoices are always "D/DLLC". */
export const SERIES_KEYS = ["DIPL-DOM", "DIPL-EXP", "DLLC-DOM"] as const;
export type SeriesKey = (typeof SERIES_KEYS)[number];

export const SERIES_LABEL: Record<SeriesKey, string> = {
  "DIPL-DOM": "India, domestic",
  "DIPL-EXP": "India, export",
  "DLLC-DOM": "UAE (shared with Partner Commissions)",
};

export function seriesKeyFor(entity: InvoiceEntityCode, kind: InvoiceKind): SeriesKey {
  if (entity === "DLLC") return "DLLC-DOM";
  return kind === "EXP" ? "DIPL-EXP" : "DIPL-DOM";
}

/** The kind an invoice is issued as: DLLC invoices are always DOM, as on DESMA's template. */
export function effectiveKind(entity: InvoiceEntityCode, kind: InvoiceKind): InvoiceKind {
  return entity === "DLLC" ? "DOM" : kind;
}

// ── money ────────────────────────────────────────────────────────────────────

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * GST inside an amount that already includes it, at 18%.
 * ₹34,220 → taxable ₹29,000 + CGST ₹2,610 + SGST ₹2,610.
 * The parts always add back to the gross, to the paisa.
 */
export function splitGst(gross: number, sameState: boolean): { taxable: number; cgst: number; sgst: number; igst: number } {
  const g = round2(gross);
  const taxable = round2(g / (1 + GST_RATE_PCT / 100));
  const gst = round2(g - taxable);
  if (!sameState) return { taxable, cgst: 0, sgst: 0, igst: gst };
  const cgst = round2(gst / 2);
  return { taxable, cgst, sgst: round2(gst - cgst), igst: 0 };
}

export type InvoiceAmounts = {
  /** The currency the invoice is printed in. */
  currency: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** In `currency`. */
  total: number;
  /** The bank credit in rupees: the ledger row's amount. */
  receivedInr: number;
  /** Rupees per one unit of `currency`; 1 for INR. */
  exchangeRate: number;
};

export type AmountsProblem =
  | "amount_not_positive"
  | "foreign_amount_required"
  | "foreign_currency_invalid"
  | "foreign_not_allowed";

/** ISO 4217 code, three capital letters. */
export function isCurrencyCode(v: string): boolean {
  return /^[A-Z]{3}$/.test(v);
}

export function computeInvoiceAmounts(input: {
  entity: InvoiceEntityCode;
  kind: InvoiceKind;
  receivedInr: number;
  /** DIPL domestic only: the candidate is in the issuer's state. */
  sameState: boolean;
  /** What the candidate paid in a foreign currency: required for DLLC, optional for export. */
  foreign: { currency: string; amount: number } | null;
}): InvoiceAmounts | { problem: AmountsProblem } {
  const receivedInr = round2(input.receivedInr);
  if (!(receivedInr > 0)) return { problem: "amount_not_positive" };
  const kind = effectiveKind(input.entity, input.kind);

  const inForeign = (f: { currency: string; amount: number }): InvoiceAmounts | { problem: AmountsProblem } => {
    const currency = f.currency.trim().toUpperCase();
    if (!isCurrencyCode(currency) || currency === "INR") return { problem: "foreign_currency_invalid" };
    const amount = round2(f.amount);
    if (!(amount > 0)) return { problem: "foreign_amount_required" };
    return {
      currency,
      taxable: amount,
      cgst: 0,
      sgst: 0,
      igst: 0,
      total: amount,
      receivedInr,
      exchangeRate: Math.round((receivedInr / amount) * 1e6) / 1e6,
    };
  };

  if (input.entity === "DLLC") {
    if (!input.foreign) return { problem: "foreign_amount_required" };
    return inForeign(input.foreign);
  }
  if (kind === "EXP") {
    if (input.foreign) return inForeign(input.foreign);
    return { currency: "INR", taxable: receivedInr, cgst: 0, sgst: 0, igst: 0, total: receivedInr, receivedInr, exchangeRate: 1 };
  }
  if (input.foreign) return { problem: "foreign_not_allowed" };
  const split = splitGst(receivedInr, input.sameState);
  return { currency: "INR", ...split, total: receivedInr, receivedInr, exchangeRate: 1 };
}

// ── numbering ────────────────────────────────────────────────────────────────

/** How the financial year is written in a number: "26-27" or "2627". */
export const FY_STYLES = ["dash", "compact"] as const;
export type FyStyle = (typeof FY_STYLES)[number];

/** Indian financial year of a YYYY-MM-DD date, written in `style`. April 2026 – March 2027 → "26-27". */
export function fyCode(isoDate: string, style: FyStyle = "dash"): string {
  const [y, m] = isoDate.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  const a = String(start).slice(-2);
  const b = String(start + 1).slice(-2);
  return style === "compact" ? `${a}${b}` : `${a}-${b}`;
}

/** The fixed part of every number in a series for that year: "D/DIPL/26-27/". */
export function seriesStem(prefix: string, isoDate: string, style: FyStyle): string {
  return `${prefix}${fyCode(isoDate, style)}/`;
}

/** The running number of `number` within `stem`, or null when it isn't in it. */
export function seqInStem(stem: string, number: string | null | undefined): number | null {
  const n = (number ?? "").trim();
  if (!n.startsWith(stem)) return null;
  const tail = n.slice(stem.length);
  return /^\d+$/.test(tail) ? Number(tail) : null;
}

/**
 * The next running number in a series for one year: one above the highest
 * already used there, and never below a "next number" floor set for that year
 * (the series continues numbers raised outside DesGro). A floor written for a
 * different year is ignored, so numbering restarts at 1 every April.
 */
export function nextSeq(stem: string, used: Array<string | null | undefined>, floors: Array<string | null | undefined>): number {
  let next = 1;
  for (const n of used) {
    const seq = seqInStem(stem, n);
    if (seq != null) next = Math.max(next, seq + 1);
  }
  for (const f of floors) {
    const seq = seqInStem(stem, f);
    if (seq != null) next = Math.max(next, seq);
  }
  return next;
}

/** "D/DLLC/26-27/025" → "D/DLLC/26-27/". */
export function stemOfNumber(number: string): string {
  const i = number.lastIndexOf("/");
  return i >= 0 ? number.slice(0, i + 1) : number;
}

/** The running number at the end of a number ("…/031" → 31), or null. */
export function runningNumber(number: string): number | null {
  const tail = number.slice(stemOfNumber(number).length);
  return /^\d+$/.test(tail) ? Number(tail) : null;
}

/**
 * A series as a person reads it, ignoring how the year is written and case:
 * "D/DLLC/26-27/" and "D/DLLC/2627/" are the same series.
 */
export function stemKey(stem: string): string {
  return stem.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Both ways of writing a stem's year, for prefix searches: "D/DLLC/26-27/" → also "D/DLLC/2627/". */
export function stemVariants(stem: string): string[] {
  const m = /^(.*?)(\d{2})-?(\d{2})\/$/.exec(stem);
  return m ? [...new Set([stem, `${m[1]}${m[2]}-${m[3]}/`, `${m[1]}${m[2]}${m[3]}/`])] : [stem];
}

/** One number, however it's written: same series (any year style, any case) and same running number (leading zeros ignored). */
export function sameInvoiceNumber(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (x.toUpperCase() === y.toUpperCase()) return true;
  const sx = runningNumber(x);
  return sx != null && sx === runningNumber(y) && stemKey(stemOfNumber(x)) === stemKey(stemOfNumber(y));
}

/**
 * The numbers that belong to `stem`'s series, rewritten into `stem` so they
 * count there whatever year style they were written in
 * ("D/DLLC/26-27/030" → "D/DLLC/2627/030"). Numbers from other series are dropped.
 */
export function intoStem(stem: string, numbers: Array<string | null | undefined>): string[] {
  const key = stemKey(stem);
  const out: string[] = [];
  for (const raw of numbers) {
    const n = (raw ?? "").trim();
    const s = stemOfNumber(n);
    if (n && stemKey(s) === key && runningNumber(n) != null) out.push(`${stem}${n.slice(s.length)}`);
  }
  return out;
}

export function formatInvoiceNo(stem: string, seq: number, padding: number): string {
  return `${stem}${String(seq).padStart(Math.min(Math.max(padding, 1), 8), "0")}`;
}

/** GST rule 46: an invoice number may be at most 16 characters. */
export const GST_INVOICE_NO_MAX = 16;

/**
 * The number `ahead` places after `next` in the same series: what the
 * (ahead+1)th invoice issued from now would get. "D/DIPL/2627/0671", 2 →
 * "D/DIPL/2627/0673".
 */
export function numberAfter(next: string, ahead: number, padding: number): string {
  const seq = runningNumber(next);
  if (seq == null) return next;
  return formatInvoiceNo(stemOfNumber(next), seq + ahead, padding);
}

/**
 * Whether the next number in a series simply starts at 1 because nobody set
 * where it continues from: no number used yet this year and no "next number"
 * written for this year. Fine in April; a mistake mid-year when the series
 * carries on from invoices raised outside DesGro.
 */
export function startsAtOne(next: string, floor: string | null | undefined): boolean {
  return runningNumber(next) === 1 && seqInStem(stemOfNumber(next), floor) == null;
}

/**
 * The number each waiting payment gets if Finance issues them from the top
 * down: per series and financial year, that series' next number, then one
 * more for every payment above it in the same series. DIPL payments go to
 * the export series only when the ledger row already says EXP, as the Issue
 * form defaults. Rows that can't be issued yet (`blocked`) get none.
 */
export function projectNumbers(
  rows: Array<{ id: string; date: string; entityCode: string | null; expDom: string | null; blocked: boolean }>,
  upcomingByFy: Record<string, Record<string, string>>,
  paddingByKey: Record<string, number>,
): Record<string, string> {
  const taken = new Map<string, number>();
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.blocked) continue;
    const entity: InvoiceEntityCode = r.entityCode === "DLLC" ? "DLLC" : "DIPL";
    const key = seriesKeyFor(entity, effectiveKind(entity, r.expDom === "EXP" ? "EXP" : "DOM"));
    const fy = fyCode(r.date);
    const next = upcomingByFy[fy]?.[key];
    if (!next) continue;
    const slot = `${fy}|${key}`;
    const ahead = taken.get(slot) ?? 0;
    taken.set(slot, ahead + 1);
    out[r.id] = numberAfter(next, ahead, paddingByKey[key] ?? 3);
  }
  return out;
}

export type CorrectionProblem = "format" | "year" | "zero";

/**
 * The number an issued invoice is corrected to. Finance types either the
 * whole number ("D/DIPL/2627/670") or just the running number ("670"); it is
 * written the way the series writes numbers now, in the invoice's own
 * financial year, padded: "D/DIPL/2627/0670".
 */
export function correctedNumber(
  typed: string,
  series: { prefix: string; fyStyle: FyStyle; padding: number },
  invoiceDate: string,
): { number: string; seq: number } | { problem: CorrectionProblem } {
  const t = typed.trim().toUpperCase();
  const stem = seriesStem(series.prefix, invoiceDate, series.fyStyle);
  let seq: number | null = null;
  if (/^\d{1,6}$/.test(t)) seq = Number(t);
  else if (isSeriesNumber(series.prefix, series.fyStyle, t)) {
    if (!t.startsWith(stem)) return { problem: "year" };
    const tail = t.slice(stem.length);
    if (tail.length > 6) return { problem: "format" };
    seq = Number(tail);
  } else return { problem: "format" };
  if (!(seq >= 1)) return { problem: "zero" };
  return { number: formatInvoiceNo(stem, seq, series.padding), seq };
}

/**
 * An issued invoice's number may be corrected only until its month's GSTR-1
 * falls due (the 11th of the next month): dated this month, or last month
 * while today is the 10th or earlier. After that the number may already be in
 * a filed return, so the CA decides (cancel, credit note).
 */
export function numberCorrectionOpen(invoiceDate: string, today: string): boolean {
  const inv = invoiceDate.slice(0, 7);
  const now = today.slice(0, 7);
  if (inv === now) return true;
  const [y, m] = inv.split("-").map(Number);
  const following = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return now === following && Number(today.slice(8, 10)) <= 10;
}

// ── words ────────────────────────────────────────────────────────────────────

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under100(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
}

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
  if (n % 100) parts.push(under100(n % 100));
  return parts.join(" ");
}

/** Whole number in words. Indian grouping (lakh, crore) for rupees, international otherwise. */
export function wholeInWords(n: number, indian: boolean): string {
  let rest = Math.floor(Math.abs(n));
  if (rest === 0) return "Zero";
  const units: Array<[number, string]> = indian
    ? [[1e7, "Crore"], [1e5, "Lakh"], [1e3, "Thousand"]]
    : [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]];
  const parts: string[] = [];
  for (const [unit, label] of units) {
    if (rest >= unit) {
      const count = Math.floor(rest / unit);
      parts.push(`${indian && unit === 1e7 ? wholeInWords(count, true) : under1000(count)} ${label}`);
      rest %= unit;
    }
  }
  if (rest) parts.push(under1000(rest));
  return parts.join(" ");
}

const CURRENCY_WORDS: Record<string, { unit: string; minor: string }> = {
  AUD: { unit: "Australian Dollars", minor: "Cents" },
  CAD: { unit: "Canadian Dollars", minor: "Cents" },
  NZD: { unit: "New Zealand Dollars", minor: "Cents" },
  USD: { unit: "US Dollars", minor: "Cents" },
  SGD: { unit: "Singapore Dollars", minor: "Cents" },
  EUR: { unit: "Euros", minor: "Cents" },
  GBP: { unit: "Pounds Sterling", minor: "Pence" },
  SAR: { unit: "Saudi Riyals", minor: "Halalas" },
  QAR: { unit: "Qatari Riyals", minor: "Dirhams" },
  OMR: { unit: "Omani Rials", minor: "Baisa" },
  KWD: { unit: "Kuwaiti Dinars", minor: "Fils" },
  BHD: { unit: "Bahraini Dinars", minor: "Fils" },
};

/**
 * The "Amount in Words" line, in the style of DESMA's own invoices:
 *   INR 34220   → "INR Thirty Four Thousand Two Hundred Twenty"
 *   AED 1400    → "AED One Thousand Four Hundred"
 *   CAD 624.08  → "Six Hundred Twenty Four Canadian Dollars and Eight Cents"
 */
export function amountInWords(amount: number, currency: string): string {
  const v = round2(Math.abs(amount));
  const whole = Math.floor(v);
  const minor = Math.round((v - whole) * 100);
  const cur = currency.toUpperCase();
  if (cur === "INR") return `INR ${wholeInWords(whole, true)}${minor ? ` and ${under100(minor)} Paise` : ""}`;
  if (cur === "AED") return `AED ${wholeInWords(whole, false)}${minor ? ` and ${under100(minor)} Fils` : ""}`;
  const w = CURRENCY_WORDS[cur];
  if (w) return `${wholeInWords(whole, false)} ${w.unit}${minor ? ` and ${under100(minor)} ${w.minor}` : ""}`;
  return `${cur} ${wholeInWords(whole, false)}${minor ? ` and ${under100(minor)} Cents` : ""}`;
}

// ── the ledger row behind an invoice ─────────────────────────────────────────

/**
 * Ledger fields an issued invoice depends on. While a live (not cancelled)
 * invoice exists for a row, none of these may change and the row can't be
 * deleted: cancel the invoice first. Category, sub-item and description don't
 * print, so they stay editable.
 */
export const INVOICE_LOCKED_FIELDS = ["type", "date", "amount", "paymentMode", "partyId", "expDom"] as const;

type LedgerShape = {
  type?: unknown;
  date?: unknown;
  amount?: unknown;
  paymentMode?: unknown;
  partyId?: unknown;
  expDom?: unknown;
};

function normalise(field: (typeof INVOICE_LOCKED_FIELDS)[number], v: unknown): string {
  if (v == null || v === "") return "";
  if (field === "date") {
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
  }
  if (field === "amount") {
    const n = Number(typeof v === "object" && v !== null && "toString" in v ? String(v) : v);
    return Number.isFinite(n) ? round2(n).toFixed(2) : String(v);
  }
  return String(v);
}

/** The locked fields a proposed edit would change. Empty = the edit leaves the invoice true. */
export function lockedFieldChanges(current: LedgerShape, proposed: LedgerShape): string[] {
  return INVOICE_LOCKED_FIELDS.filter((f) => f in proposed && normalise(f, current[f]) !== normalise(f, proposed[f]));
}

// ── what can be invoiced ─────────────────────────────────────────────────────

export type NotInvoiceableReason =
  | "not_revenue"
  | "deleted"
  | "historical"
  | "no_candidate"
  | "partner_commission"
  | "not_invoice_bank"
  | "bank_off"
  | "before_cutover"
  | "no_cutover";

/** Why a ledger row can't get a candidate invoice, or null when it can. */
export function notInvoiceableReason(
  tx: {
    type: string;
    deletedAt: Date | null;
    isHistorical: boolean;
    category: string;
    paymentMode: string;
    date: string; // YYYY-MM-DD
    partyGroup: string | null;
  },
  opts: { activeBanks: readonly string[]; startsOn: string | null },
): NotInvoiceableReason | null {
  if (tx.type !== "Revenue") return "not_revenue";
  if (tx.deletedAt) return "deleted";
  if (tx.isHistorical) return "historical";
  // Partner Commission receipts already carry their own invoice to the institution.
  if (tx.category === "Commissions") return "partner_commission";
  if (tx.partyGroup !== "Candidate") return "no_candidate";
  if (!isInvoiceBank(tx.paymentMode)) return "not_invoice_bank";
  if (!opts.activeBanks.includes(tx.paymentMode)) return "bank_off";
  if (!opts.startsOn) return "no_cutover";
  if (tx.date < opts.startsOn) return "before_cutover";
  return null;
}

export const NOT_INVOICEABLE_MESSAGE: Record<NotInvoiceableReason, string> = {
  not_revenue: "Only payments received (Revenue) can be invoiced.",
  deleted: "That ledger entry was deleted.",
  historical: "Payments from before DesGro aren't invoiced here.",
  no_candidate: "Link the payment to a candidate before invoicing it.",
  partner_commission: "Partner Commission receipts are invoiced in Partner Commissions.",
  not_invoice_bank: "Invoices are only issued for payments into Axis, HDFC or Wio.",
  bank_off: "Invoicing is switched off for that bank in Invoice settings.",
  before_cutover: "That payment is from before in-app invoicing started.",
  no_cutover: "Set the date in-app invoicing starts on in Invoice settings first.",
};

/**
 * Default line description, from the ledger sub-item:
 * "AHPRA OBA Pathway (Sales)" → "AHPRA OBA Pathway". Finance words it properly
 * ("AHPRA 2nd Instalment of Initial Payment") before issuing.
 */
export function defaultDescription(subItem: string | null | undefined): string {
  return (subItem ?? "").replace(/\s*\((Sales|Collection)\)\s*$/i, "").trim();
}

// ── settings ─────────────────────────────────────────────────────────────────

/** GSTIN shape: 2-digit state, PAN, entity digit, Z, check character. */
export function isGstin(v: string | null | undefined): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test((v ?? "").trim());
}

export type EntitySetup = {
  code: string;
  legalName: string;
  headerLines: string;
  signFor: string;
  signatoryName: string;
  gstin: string | null;
  sacCode: string;
  hasSignature: boolean;
};

/**
 * What Invoice settings still lack before an invoice can be issued for a
 * payment into `bank`, in words Finance can act on. Empty = ready.
 */
export function setupGaps(
  entity: EntitySetup | null,
  bank: { paymentMode: string; details: string } | null,
  series: { prefix: string } | null,
): string[] {
  const gaps: string[] = [];
  if (!entity) return ["the issuing company"];
  const name = entity.code === "DIPL" ? "India company" : "UAE company";
  if (!entity.legalName.trim()) gaps.push(`${name}: legal name`);
  if (!entity.headerLines.trim()) gaps.push(`${name}: address lines`);
  if (!entity.signFor.trim()) gaps.push(`${name}: "For …" line`);
  if (!entity.signatoryName.trim()) gaps.push(`${name}: signatory name`);
  if (!entity.hasSignature) gaps.push(`${name}: signature image`);
  if (entity.code === "DIPL") {
    if (!isGstin(entity.gstin) || !gstStateOfGstin(entity.gstin)) gaps.push(`${name}: GSTIN`);
    if (!/^\d{4,8}$/.test(entity.sacCode.trim())) gaps.push(`${name}: SAC code`);
  }
  if (!bank || !bank.details.trim()) gaps.push(`${bank?.paymentMode ?? "bank"}: bank details to print`);
  if (!series || !series.prefix.trim()) gaps.push("number series prefix");
  return gaps;
}

/** A "next number" setting must belong to its series: prefix, a year, a running number. */
export function isSeriesNumber(prefix: string, style: FyStyle, value: string): boolean {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fy = style === "compact" ? "\\d{4}" : "\\d{2}-\\d{2}";
  return new RegExp(`^${esc}${fy}/\\d+$`).test(value.trim());
}

// ── bill-to ──────────────────────────────────────────────────────────────────

export function isIndia(country: string): boolean {
  return /^(india|in|bharat)$/i.test(country.trim());
}

/** The lines under the candidate's name: their address, then "PIN: 685511, Kerala, India". */
export function billToLines(b: { address: string; pin: string; state: string | null; country: string }): string[] {
  const lines = b.address.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const country = b.country.trim() || "India";
  if (isIndia(country)) {
    lines.push([b.pin.trim() ? `PIN: ${b.pin.trim()}` : "", b.state?.trim() ?? "", "India"].filter(Boolean).join(", "));
  } else {
    lines.push([b.state?.trim() ?? "", country, b.pin.trim()].filter(Boolean).join(", "));
  }
  return lines;
}

/**
 * A "next number" rewritten for a series whose prefix, year style or digits
 * changed: same financial year, same running number. Null when `value`
 * doesn't belong to the old format.
 */
export function restyleNumber(
  value: string,
  from: { prefix: string; fyStyle: FyStyle },
  to: { prefix: string; fyStyle: FyStyle; padding: number },
): string | null {
  const esc = from.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fy = from.fyStyle === "compact" ? "(\\d{2})(\\d{2})" : "(\\d{2})-(\\d{2})";
  const m = new RegExp(`^${esc}${fy}/(\\d+)$`).exec(value.trim());
  if (!m) return null;
  const year = to.fyStyle === "compact" ? `${m[1]}${m[2]}` : `${m[1]}-${m[2]}`;
  return formatInvoiceNo(`${to.prefix}${year}/`, Number(m[3]), to.padding);
}
