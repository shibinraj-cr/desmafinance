import { MAX_INSTALLMENTS, type EnrollmentState, type InvoiceLayout, type InvoiceStatus } from "./constants";

/**
 * Pure rules for Partner Commissions — no database, no dates from the clock.
 * Everything that decides money or state lives here so it is unit-tested
 * (tests/partner-commissions.test.ts) and shared by the API and the UI.
 */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Commission on a course fee at a percentage, to the cent. */
export function commissionOf(courseFee: number, pct: number): number {
  return round2((courseFee * pct) / 100);
}

export function paidOf(payments: Array<{ amount: number }>): number {
  return round2(payments.reduce((s, p) => s + p.amount, 0));
}

export function balanceOf(courseFee: number, payments: Array<{ amount: number }>): number {
  return Math.max(0, round2(courseFee - paidOf(payments)));
}

/**
 * The state an enrollment is shown in. `invoiceStatus` is the status of the
 * invoice that currently claims it (null when none).
 */
export function enrollmentState(e: {
  status: string;
  courseFee: number;
  payments: Array<{ amount: number }>;
  invoiceStatus: string | null;
}): EnrollmentState {
  if (e.status === "withdrawn") return "withdrawn";
  if (e.invoiceStatus) return e.invoiceStatus === "paid" ? "received" : "invoiced";
  if (balanceOf(e.courseFee, e.payments) === 0) return "fullypaid";
  return paidOf(e.payments) === 0 ? "notstarted" : "paying";
}

/**
 * Validate the next course-fee installment. Returns an error message, or null
 * when it may be recorded. `today` is the IST calendar date (YYYY-MM-DD).
 */
export function checkInstallment(opts: {
  courseFee: number;
  payments: Array<{ amount: number }>;
  amount: number;
  paidOn: string;
  today: string;
}): string | null {
  const { courseFee, payments, amount, paidOn, today } = opts;
  if (payments.length >= MAX_INSTALLMENTS) return `All ${MAX_INSTALLMENTS} installments are already recorded.`;
  if (!(amount > 0)) return "Enter the amount the candidate paid.";
  const bal = balanceOf(courseFee, payments);
  if (bal === 0) return "The course fee is already fully paid.";
  if (round2(amount) > bal) return `That's more than the balance of AUD ${fmtMoney(bal)}.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return "Pick the date the candidate paid.";
  if (paidOn > today) return "The payment date can't be in the future.";
  return null;
}

/** `fullyPaidOn` for an enrollment: the date of the payment that cleared it. */
export function fullyPaidOn(courseFee: number, payments: Array<{ amount: number; paidOn: string }>): string | null {
  if (balanceOf(courseFee, payments) > 0 || payments.length === 0) return null;
  return payments.reduce((latest, p) => (p.paidOn > latest ? p.paidOn : latest), payments[0].paidOn);
}

// ── numbers & words ──────────────────────────────────────────────────────────

export function fmtMoney(n: number): string {
  const r = round2(n);
  return r.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(r) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Invoice style: "7060", "460", "1234.50" — no thousands separators, as on the template. */
export function fmtInvoiceNumber(n: number): string {
  const r = round2(n);
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under1000(n: number): string {
  const out: string[] = [];
  if (n >= 100) {
    out.push(ONES[Math.floor(n / 100)], "Hundred");
    n %= 100;
  }
  if (n >= 20) out.push(TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : ""));
  else if (n > 0) out.push(ONES[n]);
  return out.join(" ");
}

/** 7060 → "Seven Thousand Sixty"; 1234.5 → "One Thousand Two Hundred Thirty-Four and Fifty Cents". */
export function numberToWords(n: number): string {
  const v = round2(Math.abs(n));
  const whole = Math.floor(v);
  const cents = Math.round((v - whole) * 100);
  if (whole === 0 && cents === 0) return "Zero";
  const parts: string[] = [];
  let rest = whole;
  for (const [unit, label] of [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]] as const) {
    if (rest >= unit) {
      parts.push(under1000(Math.floor(rest / unit)), label);
      rest %= unit;
    }
  }
  if (rest) parts.push(under1000(rest));
  let s = parts.join(" ") || "Zero";
  if (cents) s += ` and ${under1000(cents)} Cents`;
  return s;
}

export function amountInWords(total: number, currency = "AUD"): string {
  return `${currency} ${numberToWords(total)}`;
}

// ── dates ────────────────────────────────────────────────────────────────────

/** Indian financial year label for a YYYY-MM-DD date: April 2026 – March 2027 → "26-27". */
export function fyLabel(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

/** "Jan-27" style month code for a YYYY-MM-DD date. */
export function monthCodeOf(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}-${String(y).slice(-2)}`;
}

/** Intake months offered on the form: from 12 months back to 18 months ahead of `today`. */
export function intakeMonthOptions(today: string): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = -12; i <= 18; i++) {
    const idx = (m - 1 + i) % 12;
    const mm = (idx + 12) % 12;
    const yy = y + Math.floor((m - 1 + i) / 12);
    out.push(monthCodeOf(`${yy}-${String(mm + 1).padStart(2, "0")}-01`));
  }
  return out;
}

export function isIntakeMonth(v: string): boolean {
  return /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2}$/.test(v);
}

/** The running number of `number` within `series` ("D/DLLC/26-27/"), or null when it isn't in it. */
function seqIn(series: string, number: string): number | null {
  if (!number.startsWith(series)) return null;
  const tail = number.slice(series.length);
  return /^\d+$/.test(tail) ? Number(tail) : null;
}

/**
 * Suggested next invoice number in `prefix + FY + "/" + NNN`, one above the
 * highest number already used in that series.
 *
 * The series is shared with invoices raised outside DesGro, which DesGro can't
 * see — so `floor` (the "Next invoice number" setting) sets the lowest number
 * it may suggest. It only applies within its own financial year: once the
 * invoice date reaches the next April, numbering starts again at 001. Finance
 * can still change any number before payment.
 */
export function suggestInvoiceNumber(prefix: string, isoDate: string, existing: string[], floor?: string | null): string {
  const series = `${prefix}${fyLabel(isoDate)}/`;
  let next = 1;
  for (const n of existing) {
    const seq = seqIn(series, n);
    if (seq != null) next = Math.max(next, seq + 1);
  }
  const min = floor ? seqIn(series, floor.trim()) : null;
  if (min != null) next = Math.max(next, min);
  return `${series}${String(next).padStart(3, "0")}`;
}

/** True when the number follows the series shape, e.g. D/DLLC/26-27/012. */
export function looksLikeSeries(prefix: string, number: string): boolean {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc}\\d{2}-\\d{2}/\\d{3,}$`).test(number);
}

/**
 * Whether the monthly run is due: on or after `runDay` of the IST month and
 * not yet run for that month. A missed day (outage) catches up next day.
 */
export function runDue(todayIst: string, runDay: number, alreadyRanThisMonth: boolean): boolean {
  if (alreadyRanThisMonth) return false;
  const day = Number(todayIst.slice(8, 10));
  return day >= Math.min(Math.max(runDay, 1), 28);
}

/** The next run date on or after `todayIst`, for display. */
export function nextRunDate(todayIst: string, runDay: number, ranThisMonth: boolean): string {
  const [y, m, d] = todayIst.split("-").map(Number);
  const day = Math.min(Math.max(runDay, 1), 28);
  if (!ranThisMonth && d <= day) return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!ranThisMonth) return todayIst; // overdue: runs at the next cron fire
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ── invoice lines & payments ─────────────────────────────────────────────────

/** Default description for an invoice line, by the partner's layout. */
export function defaultLineDescription(layout: InvoiceLayout | string, candidateName: string, program: string): string {
  return layout === "detailed" ? candidateName : `${candidateName} | ${program} | Full Fee Paid`;
}

export function invoiceTotal(lines: Array<{ amount: number }>): number {
  return round2(lines.reduce((s, l) => s + l.amount, 0));
}

/**
 * Split an INR receipt across programs in proportion to each program's share
 * of the invoice, so Revenue › Commissions › {program} Commission stays true
 * when one invoice mixes OSCE and NCLEX. Whole rupees; the last program takes
 * the rounding remainder so the parts always add up to the receipt.
 */
export function splitByProgram(
  lines: Array<{ program: string; amount: number }>,
  inr: number,
): Array<{ program: string; inr: number; aud: number }> {
  const total = round2(Math.round(inr * 100) / 100);
  const byProgram = new Map<string, number>();
  for (const l of lines) byProgram.set(l.program, round2((byProgram.get(l.program) ?? 0) + l.amount));
  const programs = [...byProgram.keys()].sort();
  const aud = invoiceTotal(lines);
  if (programs.length === 0) return [];
  if (programs.length === 1 || aud <= 0) return [{ program: programs[0], inr: total, aud }];
  let acc = 0;
  return programs.map((p, i) => {
    const share = byProgram.get(p)!;
    const part = i === programs.length - 1 ? round2(total - acc) : Math.round((total * share) / aud);
    acc = round2(acc + part);
    return { program: p, inr: part, aud: share };
  });
}

/** AUD still open on an invoice: total less approved and awaiting receipts. */
export function openAud(total: number, receipts: Array<{ status: string; audSettled: number }>): number {
  const taken = receipts
    .filter((r) => r.status === "approved" || r.status === "awaiting")
    .reduce((s, r) => s + r.audSettled, 0);
  return Math.max(0, round2(total - taken));
}

/** Invoice status once a receipt has been approved. */
export function statusAfterApproval(opts: {
  total: number;
  approvedAud: number;
  settleInFull: boolean;
}): InvoiceStatus {
  return opts.settleInFull || round2(opts.approvedAud) >= round2(opts.total) ? "paid" : "partpaid";
}

/** Invoice status when a receipt is sent back. */
export function statusAfterReturn(approvedAud: number): InvoiceStatus {
  return approvedAud > 0 ? "partpaid" : "sent";
}

export function isEditableInvoice(status: string): boolean {
  return status === "draft" || status === "sent";
}

/**
 * Programs a person may add enrollments for.
 *   - Finance (anyone with the Finance page): every program.
 *   - Active BDEs (Lead Pulse L1/L2): the programs Settings opens to BDEs (GCAN by default).
 *   - Anyone with a personal grant: the programs on it.
 */
export function enrollablePrograms(opts: {
  isFinance: boolean;
  isBde: boolean;
  bdePrograms: string[];
  grantPrograms: string[];
  allPrograms: readonly string[];
}): string[] {
  if (opts.isFinance) return [...opts.allPrograms];
  const set = new Set<string>();
  if (opts.isBde) opts.bdePrograms.forEach((p) => set.add(p));
  opts.grantPrograms.forEach((p) => set.add(p));
  return opts.allPrograms.filter((p) => set.has(p));
}
