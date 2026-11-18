/**
 * Bank reconciliation rules, pure: which ledger entry a bank line is, which
 * two bank lines are one transfer between DesGro's own accounts, and what a
 * line that has no ledger entry yet should be booked as.
 *
 * Deterministic and explainable. Every candidate gets a score from named
 * signals, and the reasons are shown to Finance. Only an exact reference with
 * an exact amount, and only one entry carrying it, is matched without a
 * person; everything else is a suggestion Finance confirms in one click.
 */

export const SUGGEST_SCORE = 55;
/** Ledger entries this far either side of the bank date are candidates. */
export const DAY_WINDOW = 7;
/** A reference match may be further apart (a cheque, a late booking). */
export const REF_DAY_WINDOW = 30;
/** The two legs of a transfer between DesGro's accounts. */
export const TRANSFER_DAY_WINDOW = 3;
/** Credits at or under this are the ₹1 test credits payers send first. */
export const TEST_CREDIT_MAX = 10;

/** The ledger's payment mode for each bank's account. */
export const LEDGER_MODE: Record<string, string> = { HDFC: "HDFC Bank", AXIS: "Axis Bank", WIO: "Wio Bank" };

const NAME_STOP = new Set(["PRIVATE", "LIMITED", "PVT", "LTD", "INDIA", "SERVICES", "SERVICE", "BANK", "THE", "AND", "COMPANY", "ENTERPRISES", "INTERNATIONAL", "CONSULTANCY", "SOLUTIONS", "PAYMENT", "TRANSFER"]);

export type BankLine = {
  id: string;
  integrationId: string;
  bankCode: string;
  accountLastFour: string;
  direction: "DEBIT" | "CREDIT";
  /** Paise. */
  amount: number;
  txnDate: string;
  description: string;
  references: string[];
};

export type LedgerEntry = {
  id: string;
  date: string;
  /** Payment ids in the description, worked out once (tokensOf). */
  refs?: Set<string>;
  type: "Revenue" | "Expense";
  /** Paise. */
  amount: number;
  /** Paise of it already tied to other bank lines. */
  matched: number;
  description: string | null;
  counterparty: string | null;
  paymentMode: string;
};

export type Scored = { id: string; score: number; reasons: string[]; refMatch: boolean; exact: boolean; open: number };

export function daysApart(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));
}

/** A reference as compared: letters and digits only, upper case, leading zeros dropped. */
export function normRef(s: string | null | undefined): string | null {
  const v = (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
  // Short tokens and plain small numbers are not references.
  return v.length >= 6 && /\d/.test(v) ? v : null;
}

/** Identifiers that are not payment references: they name a payer or account, not one payment. */
const NOT_A_PAYMENT_REF = [
  /^[A-Z]{4}0[A-Z0-9]{6}$/, // IFSC (branch)
  /^[A-Z]{5}\d{4}[A-Z]$/, // PAN
  /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]{2}$/, // GSTIN
  /^[6-9]\d{9}$/, // a mobile number (UPI IDs carry them)
  /^X{2,}\d+$/, // a masked account number
];
const notPaymentRef = (r: string) => NOT_A_PAYMENT_REF.some((re) => re.test(r));

/**
 * A narration token shaped like one payment's id: a 12-digit UPI / IMPS RRN,
 * or a NEFT / RTGS UTR (bank code + 11–18 more, mostly digits).
 */
function looksLikePaymentId(r: string): boolean {
  if (notPaymentRef(r)) return false;
  return /^\d{12}$/.test(r) || (/^[A-Z]{4}[A-Z0-9]{11,18}$/.test(r) && (r.match(/\d/g) ?? []).length >= 8);
}

/** Payment ids in free text (a ledger description, a narration). */
export function tokensOf(text: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of (text ?? "").toUpperCase().matchAll(/[A-Z0-9]{6,}/g)) {
    const r = normRef(m[0]);
    if (r && looksLikePaymentId(r)) out.add(r);
  }
  return Array.from(out);
}

/**
 * The payment references a bank line carries: its reference fields (when they
 * hold a payment id, not a phone number, a masked account or a branch code)
 * plus payment ids in the narration. Loan numbers, phone numbers and the like
 * identify a payer, not a payment, and are never matched on.
 */
export function referencesOf(t: { referenceNumber: string | null; upiReference: string | null; bankReference: string | null; description: string }): string[] {
  const out = new Set<string>(tokensOf(t.description));
  for (const raw of [t.upiReference, t.bankReference, t.referenceNumber]) {
    const r = normRef(raw);
    if (r && !notPaymentRef(r) && r.length >= 8 && (r.match(/\d/g) ?? []).length >= 6) out.add(r);
  }
  return Array.from(out);
}

/** The best single reference to write into a ledger entry booked from the line. */
export function primaryReference(t: { referenceNumber: string | null; upiReference: string | null; bankReference: string | null; description: string }): string | null {
  return referencesOf({ ...t, description: "" })[0] ?? tokensOf(t.description)[0] ?? null;
}

const wantedType = (b: BankLine) => (b.direction === "CREDIT" ? "Revenue" : "Expense");

export function scoreLedger(bank: BankLine, l: LedgerEntry): Scored {
  let score = 0;
  const reasons: string[] = [];
  const open = l.amount - l.matched;
  const exact = open === bank.amount;
  if (exact) {
    score += 40;
    reasons.push(l.matched ? "Exactly what is still open" : "Exact amount");
  } else if (open > bank.amount) {
    score += 15;
    reasons.push("Part of a larger entry");
  }
  const refs = l.refs ?? new Set(tokensOf(l.description));
  const ref = bank.references.find((r) => refs.has(r));
  if (ref) {
    score += 40;
    reasons.push(`Reference ${ref} in the ledger entry`);
  }
  const gap = daysApart(bank.txnDate, l.date);
  if (gap === 0) {
    score += 15;
    reasons.push("Same date");
  } else if (gap === 1) {
    score += 10;
    reasons.push("1 day apart");
  } else if (gap <= 3) {
    score += 5;
    reasons.push(`${gap} days apart`);
  }
  if (l.counterparty) {
    const narr = ` ${bank.description.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
    const words = l.counterparty.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4 && !NAME_STOP.has(w));
    const hit = words.find((w) => narr.includes(` ${w} `));
    if (hit) {
      score += 15;
      reasons.push(`Name "${l.counterparty}" in the narration`);
    }
  }
  const own = LEDGER_MODE[bank.bankCode];
  const otherBank = Object.values(LEDGER_MODE).includes(l.paymentMode) && l.paymentMode !== own;
  if (own && l.paymentMode === own) {
    score += 10;
    reasons.push(`Booked as ${own}`);
  } else if (otherBank) {
    score -= 30;
    reasons.push(`Booked as ${l.paymentMode}, not this bank`);
  }
  return { id: l.id, score, reasons, refMatch: !!ref, exact, open };
}

/** Candidates for one bank line, best first: right side, open amount, in the date window. */
export function rankLedger(bank: BankLine, entries: LedgerEntry[]): Scored[] {
  return entries
    .filter((l) => l.type === wantedType(bank) && l.amount - l.matched > 0)
    .map((l) => ({ l, s: scoreLedger(bank, l) }))
    .filter(({ l, s }) => daysApart(bank.txnDate, l.date) <= (s.refMatch ? REF_DAY_WINDOW : DAY_WINDOW))
    .map(({ s }) => s)
    .sort((a, b) => b.score - a.score);
}

/**
 * The one ledger entry a bank line can be matched to without a person: the
 * same reference and exactly the open amount, and no other entry carrying
 * that reference. Anything else is left for Finance.
 */
export function autoMatchFor(bank: BankLine, ranked: Scored[]): Scored | null {
  const byRef = ranked.filter((s) => s.refMatch);
  if (byRef.length !== 1) return null;
  const [only] = byRef;
  return only.exact && only.score >= 80 ? only : null;
}

const RAIL_WORDS = new Set(["NEFT", "RTGS", "IMPS", "UPI", "HDFC", "AXIS", "AXISBANK", "BANK", "TRANSFER", "PAYMENT", "NETBANK", "CR", "DR", "P2A", "P2M", "INB", "MOB", "FUNDS", "SELF", "OWN", "ACCOUNT"]);
/** The words of a narration that can be a name: letters only, 4+ long, not a rail or a stop word. */
function nameWords(description: string): string[] {
  return Array.from(new Set(description.toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 4 && !RAIL_WORDS.has(w) && !NAME_STOP.has(w))));
}

export function scoreTransfer(a: BankLine, b: BankLine): Scored {
  let score = 0;
  const reasons: string[] = [];
  if (a.amount === b.amount && a.direction !== b.direction) {
    score += 40;
    reasons.push("Same amount, opposite sides");
  }
  const gap = daysApart(a.txnDate, b.txnDate);
  score += gap === 0 ? 15 : gap === 1 ? 10 : 5;
  reasons.push(gap === 0 ? "Same date" : `${gap} day${gap === 1 ? "" : "s"} apart`);
  const narr = `${a.description} ${b.description}`.toUpperCase();
  // The other account's number as a number of its own ("…TO 5678", "XXXX5678"),
  // never inside a longer one (a UTR, an IFSC).
  const names = (x: BankLine, y: BankLine) => new RegExp(`(^|[^0-9])(X+|\\*+)?${y.accountLastFour}([^0-9]|$)`).test(x.description.toUpperCase());
  if (names(a, b) || names(b, a)) {
    score += 15;
    reasons.push("The narration names the other DesGro account");
  } else if (/\b(SELF|OWN|TRF|TRANSFER|FT|IB FUNDS|TPT)\b/.test(narr)) {
    score += 10;
    reasons.push("Transfer-style narration");
  }
  // Between DesGro's own accounts both legs carry the same name: DesGro's.
  const shared = nameWords(a.description).filter((w) => nameWords(b.description).includes(w));
  if (shared.length) {
    score += 15;
    reasons.push(`The same name on both legs (${shared.slice(0, 2).join(" ")})`);
  }
  const sameRef = a.references.some((r) => b.references.includes(r));
  if (sameRef) {
    score += 30;
    reasons.push("Same reference on both sides");
  }
  return { id: b.id, score, reasons, refMatch: sameRef, exact: a.amount === b.amount, open: b.amount };
}

/** The other leg of a transfer for `a`, among unmatched lines of DesGro's OTHER accounts. */
export function rankTransfers(a: BankLine, others: BankLine[]): Scored[] {
  return others
    .filter((b) => b.integrationId !== a.integrationId && b.direction !== a.direction && b.amount === a.amount && daysApart(a.txnDate, b.txnDate) <= TRANSFER_DAY_WINDOW)
    .map((b) => scoreTransfer(a, b))
    .filter((s) => s.score >= 60)
    .sort((x, y) => y.score - x.score);
}

/** Pair without a person only on the same reference, and only when it is the one such line. */
export function autoTransferFor(ranked: Scored[]): Scored | null {
  const byRef = ranked.filter((s) => s.refMatch && s.exact);
  return byRef.length === 1 ? byRef[0] : null;
}

export const isTestCredit = (b: { direction: string; amount: number }) => b.direction === "CREDIT" && b.amount > 0 && b.amount <= TEST_CREDIT_MAX * 100;

/**
 * A narration's shape with the names and numbers taken out, so this month's
 * "ACH/D/<lender>/<loan no>" line finds last month's: the rail and the fixed
 * words stay, digits and anything containing them go.
 */
export function narrationSignature(description: string): string {
  return description
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 2 && !/\d/.test(w))
    .slice(0, 4)
    .join(" ");
}

export type PastBooking = { signature: string; amount: number; type: string; category: string; subItem: string; partyId: string | null; employeeId: string | null; date: string };

/**
 * What to book a line with no ledger entry as: how the same kind of line
 * (same narration shape, same side) was booked before, the closest amount and
 * most recent first. Null when nothing like it was ever booked.
 */
export function suggestBooking(bank: BankLine, past: PastBooking[]): PastBooking | null {
  const sig = narrationSignature(bank.description);
  if (!sig) return null;
  const same = past.filter((p) => p.signature === sig && p.type === wantedType(bank));
  if (!same.length) return null;
  return same.sort((a, b) => Math.abs(a.amount - bank.amount) - Math.abs(b.amount - bank.amount) || b.date.localeCompare(a.date))[0];
}
