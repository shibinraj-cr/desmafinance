import { MERGE_KEYS, type MergeKeyDef } from "@/lib/esign/merge-keys";

/**
 * Turning CRM data into the exact text a merge field prints.
 *
 * Pure and shared: the send wizard shows these values for staff to check and
 * edit, and whatever they confirm is snapshotted on the request and burned into
 * the PDF. Formats are written for an Indian agreement: rupees with lakh
 * grouping, amounts in words in the Indian system, dates as "15 October 2026"
 * (no 05/10 vs 10/05 ambiguity), all dates in Asia/Kolkata.
 */

const IST = "Asia/Kolkata";

/** "15 October 2026", in IST. Date-only values (a dob) are read as UTC dates. */
export function formatLongDate(d: Date, opts: { dateOnly?: boolean } = {}): string {
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: opts.dateOnly ? "UTC" : IST,
  });
}

/** Read an amount the way staff type it: "₹1,50,000", "150000.50", "1.5L" is not supported. */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = raw.replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** "₹1,50,000" — Indian grouping, paise only when there are some. */
export function formatINR(n: number): string {
  const whole = Math.round(n * 100) % 100 === 0;
  return (
    "₹" +
    n.toLocaleString("en-IN", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? ONES[h] + " Hundred" : "", r ? below100(r) : ""].filter(Boolean).join(" ");
}

/** 150000 → "One Lakh Fifty Thousand" (Indian system: thousand, lakh, crore). */
export function integerInWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("whole, non-negative amounts only");
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  const rest = n % 1e3;
  return [
    crore ? integerInWords(crore) + " Crore" : "",
    lakh ? below100(lakh) + " Lakh" : "",
    thousand ? below100(thousand) + " Thousand" : "",
    rest ? below1000(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** 150000.5 → "Rupees One Lakh Fifty Thousand and Fifty Paise Only". */
export function amountInWords(n: number): string {
  const paise = Math.round(n * 100) % 100;
  const rupees = Math.floor(Math.round(n * 100) / 100);
  return `Rupees ${integerInWords(rupees)}${paise ? ` and ${below100(paise)} Paise` : ""} Only`;
}

/** What the wizard needs from the CRM lead to fill merge keys. */
export type MergeLead = {
  candidateName: string;
  email: string | null;
  phone: string | null;
  dob: Date | null;
  serviceName: string | null;
  expectedValue: number | null;
};

export type MergeValue = {
  key: string;
  label: string;
  value: string;
  /** Where the value came from, so the wizard can say "from the CRM" or "type this". */
  origin: MergeKeyDef["from"]["kind"];
};

/**
 * Values for the given merge keys from a lead. Manual keys come back empty for
 * staff to fill; derived keys are computed from the others (and recomputed by
 * deriveMergeValues when staff edit what they depend on).
 */
export function resolveMergeValues(
  keys: string[],
  ctx: { lead: MergeLead; staffName: string; now: Date },
): Record<string, MergeValue> {
  const raw: Record<string, string> = {
    "client.full_name": ctx.lead.candidateName.trim(),
    "client.email": ctx.lead.email?.trim() ?? "",
    "client.phone": ctx.lead.phone?.trim() ?? "",
    "client.dob": ctx.lead.dob ? formatLongDate(ctx.lead.dob, { dateOnly: true }) : "",
    "deal.service_name": ctx.lead.serviceName ?? "",
    "deal.fee_amount": ctx.lead.expectedValue != null ? formatINR(ctx.lead.expectedValue) : "",
    today: formatLongDate(ctx.now),
    "staff.name": ctx.staffName,
  };
  const values = deriveMergeValues(raw, new Set());
  const out: Record<string, MergeValue> = {};
  for (const key of keys) {
    const def = MERGE_KEYS.find((k) => k.key === key);
    if (!def) continue;
    out[key] = { key, label: def.label, value: values[key] ?? "", origin: def.from.kind };
  }
  return out;
}

/**
 * Recompute derived values (fee in words, total) from the current inputs,
 * leaving alone any key staff have overridden by hand.
 */
export function deriveMergeValues(values: Record<string, string>, overridden: ReadonlySet<string>): Record<string, string> {
  const out = { ...values };
  const fee = parseAmount(values["deal.fee_amount"]);
  const gst = parseAmount(values["deal.gst_amount"]);
  if (!overridden.has("deal.fee_in_words")) out["deal.fee_in_words"] = fee != null && fee >= 0 ? amountInWords(fee) : "";
  if (!overridden.has("deal.total_amount")) {
    out["deal.total_amount"] = fee != null && gst != null ? formatINR(fee + gst) : fee != null && !values["deal.gst_amount"] ? formatINR(fee) : "";
  }
  return out;
}

/** Keys a template needs filled before it can be sent (every key its fields use). */
export function missingMergeKeys(keys: string[], values: Record<string, string>): string[] {
  return keys.filter((k) => !(values[k] ?? "").trim());
}
