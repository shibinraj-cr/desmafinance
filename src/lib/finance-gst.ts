import { splitGst } from "@/lib/invoices/core";

/**
 * GST inside the ledger's revenue. Pure and client-safe.
 *
 * `Transaction.amount` is the money that moved (what the bank shows), so cash,
 * bank matching and a candidate's "paid so far" keep using it. Revenue is
 * reported NET of GST: `amount − gstAmount`. `gstAmount` is stored on every
 * row, set from this rule at each ledger write, so a later change of rule
 * never rewrites history silently.
 *
 * The rule (the one Finance › Revenue has always used for its GST Liability
 * line, and the one candidate invoices print):
 *   - Revenue paid into Axis or HDFC, tagged DOM: GST is inside the amount at
 *     18% → amount − round2(amount / 1.18). Same split as the invoice, to the
 *     paisa.
 *   - Everything else (export, Wio, cash, UPI, cards, RCS, STR, expenses): 0.
 */

export const GST_BEARING_MODES = ["Axis Bank", "HDFC Bank"] as const;

export function gstInAmount(row: { type: string; paymentMode: string; expDom?: string | null; amount: number | string | { toString(): string } }): number {
  if (row.type !== "Revenue" || row.expDom !== "DOM") return 0;
  if (!(GST_BEARING_MODES as readonly string[]).includes(row.paymentMode)) return 0;
  const amount = Number(typeof row.amount === "object" ? row.amount.toString() : row.amount);
  if (!(amount > 0)) return 0;
  const s = splitGst(amount, true);
  return Math.round((s.cgst + s.sgst) * 100) / 100;
}

/** Revenue net of GST for one row (expenses pass through unchanged). */
export function netOfGst(amount: number, gstAmount: number | null | undefined): number {
  return Math.round((amount - (gstAmount ?? 0)) * 100) / 100;
}

/**
 * GST paid over to the government is booked as Expense › Taxes › GST. With
 * revenue reported net of GST it settles a liability; it is not a cost, so
 * profit leaves it out (counting it would take GST off twice). Cash flow,
 * which follows the money, keeps it.
 */
export const GST_REMITTANCE = { category: "Taxes", subItem: "GST" } as const;

export function isGstRemittance(row: { type: string; category?: string | null; subItem?: string | null }): boolean {
  return row.type === "Expense" && row.category === GST_REMITTANCE.category && row.subItem === GST_REMITTANCE.subItem;
}
