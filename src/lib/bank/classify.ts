/**
 * Infer a payment type (and, where the narration spells it out, the
 * counterparty and UPI reference) from a bank narration. The original
 * narration is never altered — this only produces derived columns, and an
 * unrecognised line is simply OTHER.
 *
 * Ordered most-specific first: "NEFT RETURN CHARGES" is a charge, not a NEFT.
 */

export const TRANSACTION_TYPES = [
  "UPI",
  "NEFT",
  "RTGS",
  "IMPS",
  "ACH",
  "NACH",
  "CHEQUE",
  "CARD",
  "ATM",
  "BANK_CHARGES",
  "INTEREST",
  "CASH",
  "TRANSFER",
  "OTHER",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

const RULES: Array<[TransactionType, RegExp]> = [
  ["BANK_CHARGES", /\b(CHGS?|CHARGES?|SMS ALERT|GST ON|CGST|SGST|IGST|DEBIT CARD ANNUAL|AMC|MIN BAL|NON MAINT|CONSOLIDATED CHARGES|SERVICE CHARGE)\b/],
  ["INTEREST", /\b(INT(EREST)?\.? ?(PD|PAID|CREDIT|CAPITALI[SZ]ED)|CREDIT INTEREST|SB INT|INTEREST)\b/],
  ["UPI", /\bUPI\b/],
  ["NACH", /\bNACH\b/],
  ["ACH", /\bACH\b/],
  ["RTGS", /\bRTGS\b/],
  ["NEFT", /\bNEFT\b/],
  ["IMPS", /\b(IMPS|MMT)\b/],
  ["ATM", /\b(ATM|ATW|NWD|EAW|CASH WDL)\b/],
  ["CASH", /\b(CASH DEP(OSIT)?|BY CASH|CDM|CSH DEP|SELF)\b/],
  ["CARD", /\b(POS|PCD|ECOM|DEBIT CARD|VISA|MASTERCARD|RUPAY)\b/],
  ["CHEQUE", /\b(CHQ|CHEQUE|CLG|CLEARING|INWARD CLG|CTS)\b/],
  ["TRANSFER", /\b(FT|FUND TRANSFER|TRF|TRANSFER|IB FUNDS|NETBANKING|NET BANKING|TPT)\b/],
];

export function classifyNarration(narration: string): TransactionType {
  const n = ` ${narration.toUpperCase().replace(/[-/:]/g, " ")} `;
  // A UPI line's free-text note is the payer's ("SCHOOL CHARGES"), so the
  // leading rail wins over anything the note happens to say.
  if (/^\s*UPI\b/.test(n)) return "UPI";
  for (const [type, re] of RULES) if (re.test(n)) return type;
  return "OTHER";
}

/**
 * Best-effort counterparty and references from common Indian narrations:
 *   UPI-NAME-VPA@BANK-IFSC-123456789012-NOTE
 *   NEFT CR-IFSC0001234-NAME-REF / IMPS-123456789012-NAME-BANK
 * Anything unrecognised yields nulls — never a guess dressed as fact.
 */
export function extractCounterparty(
  narration: string,
  type: TransactionType,
): { counterpartyName: string | null; upiReference: string | null; bankReference: string | null } {
  const parts = narration.split("-").map((p) => p.trim()).filter(Boolean);
  const none = { counterpartyName: null, upiReference: null, bankReference: null };
  if (parts.length < 2) return none;

  if (type === "UPI") {
    const upiRef = parts.find((p) => /^\d{12}$/.test(p)) ?? null;
    const name = parts[1] && !/@/.test(parts[1]) && !/^\d+$/.test(parts[1]) ? parts[1] : null;
    return { counterpartyName: cleanName(name), upiReference: upiRef, bankReference: null };
  }
  if (type === "NEFT" || type === "RTGS" || type === "IMPS") {
    const ref = parts.find((p) => /^[A-Z]{4}[A-Z0-9]{8,}$|^\d{10,}$/.test(p) && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(p)) ?? null;
    const name = parts.find((p, i) => i > 0 && /[A-Za-z]{3,}/.test(p) && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(p) && p !== ref && !/^(CR|DR)$/i.test(p)) ?? null;
    return { counterpartyName: cleanName(name), upiReference: null, bankReference: ref };
  }
  return none;
}

function cleanName(s: string | null): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length >= 2 && t.length <= 80 ? t : null;
}

/** Narration normalised for hashing only: case, spacing and punctuation runs folded. */
export function normalizeNarration(s: string): string {
  return s.toUpperCase().replace(/\s+/g, " ").replace(/\s*-\s*/g, "-").trim();
}
