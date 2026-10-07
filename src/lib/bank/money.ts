/**
 * Money as integer paise. Statement amounts are parsed from text straight into
 * paise and summed as integers, so validation never meets a floating-point
 * rounding error; they only become Decimal strings at the database boundary.
 * Safe up to ±9e13 rupees — far past any bank balance.
 */

export type Paise = number;

/** "1,23,456.78" | "1234.5" | "-12.00" | "12.00 Dr" → paise, or null if not an amount. */
export function parseAmount(raw: string | null | undefined): Paise | null {
  if (raw == null) return null;
  let s = raw.replace(/[₹,\s]/g, "").replace(/^INR/i, "");
  let sign = 1;
  if (/(Dr|DR)$/.test(s)) {
    sign = -1;
    s = s.slice(0, -2);
  } else if (/(Cr|CR)$/.test(s)) {
    s = s.slice(0, -2);
  }
  if (s.startsWith("(") && s.endsWith(")")) {
    sign = -sign;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    sign = -sign;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? sign * paise : null;
}

/** Looks like a statement amount column value: digits, Indian/Western grouping, two decimals. */
export function isAmountToken(s: string): boolean {
  return /^-?(\d{1,3}(,\d{2,3})*|\d+)\.\d{2}(\s?(Dr|Cr|DR|CR))?$/.test(s.trim());
}

/** paise → "1234.56" for a Prisma Decimal column. */
export function toDecimalString(p: Paise): string {
  const sign = p < 0 ? "-" : "";
  const abs = Math.abs(p);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Decimal-ish (Prisma Decimal, string, number) → paise. */
export function fromDecimal(d: { toString(): string } | string | number | null | undefined): Paise | null {
  if (d == null) return null;
  return parseAmount(typeof d === "number" ? d.toFixed(2) : d.toString());
}

export function paiseToRupees(p: Paise): number {
  return p / 100;
}
