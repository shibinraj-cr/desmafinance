/**
 * Recording a collection: what one payment does to the candidate's collection
 * plan. Pure and client-safe, so the Record payment dialog previews exactly
 * what the server will do (src/lib/collection-payment-server.ts applies it).
 *
 * The ledger gets the money as it arrived (date, amount, bank, UTR); the plan
 * keeps adding up to what the candidate owes:
 *  - paid in full: the instalment is received;
 *  - paid less: the instalment becomes what was paid, and the rest stays due
 *    on the same date as a new instalment right after it;
 *  - paid more: the extra comes off the plan's other instalments still due,
 *    earliest first; one covered in full is cancelled as "covered". More than
 *    everything still due is refused: add an instalment for the extra first.
 */
import { formatEnrollDate } from "./crm-enroll-date";

export type PlanInstalment = {
  id: string;
  seq: number;
  /** YYYY-MM-DD */
  expectedDate: string;
  amount: number;
  status: string;
};

export type PlanChange = {
  /** The instalment the payment is recorded on, with its new amount (what was paid). */
  received: { id: string; seq: number; amount: number };
  /** Paid less: what stays due, as a new instalment right after the one paid. */
  rest: { amount: number; expectedDate: string; seq: number } | null;
  /** Paid more: instalments the extra pays part of. */
  reduced: Array<{ id: string; seq: number; from: number; to: number }>;
  /** Paid more: instalments the extra pays in full. */
  covered: Array<{ id: string; seq: number; amount: number }>;
};

export type PlanChangeProblem =
  /** The instalment isn't waiting for money (received or cancelled already). */
  | { error: "collection_not_due" }
  | { error: "invalid_amount" }
  /** More than the plan still has due; `maxAmount` is the most this payment can be. */
  | { error: "collection_more_than_due"; maxAmount: number };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Statuses an instalment can take a payment in. "submitted" = its payment waits for approval. */
const PAYABLE = new Set(["pending", "submitted"]);

export function planChangeFor(instalments: PlanInstalment[], instalmentId: string, paid: number): PlanChange | PlanChangeProblem {
  const target = instalments.find((i) => i.id === instalmentId);
  if (!target || !PAYABLE.has(target.status)) return { error: "collection_not_due" };
  const amount = r2(paid);
  if (!(amount > 0) || !Number.isFinite(amount)) return { error: "invalid_amount" };

  const change: PlanChange = { received: { id: target.id, seq: target.seq, amount }, rest: null, reduced: [], covered: [] };
  const planned = r2(target.amount);
  if (amount < planned) {
    change.rest = { amount: r2(planned - amount), expectedDate: target.expectedDate, seq: target.seq + 1 };
    return change;
  }
  if (amount === planned) return change;

  // Paid more: earliest still-due instalment first. One whose payment waits
  // for approval is left alone; that payment speaks for it.
  const others = instalments
    .filter((i) => i.id !== target.id && i.status === "pending")
    .sort((a, b) => (a.expectedDate === b.expectedDate ? a.seq - b.seq : a.expectedDate < b.expectedDate ? -1 : 1));
  const maxAmount = r2(planned + others.reduce((s, i) => s + i.amount, 0));
  if (amount > maxAmount) return { error: "collection_more_than_due", maxAmount };

  let extra = r2(amount - planned);
  for (const i of others) {
    if (extra <= 0) break;
    const due = r2(i.amount);
    if (extra >= due) {
      change.covered.push({ id: i.id, seq: i.seq, amount: due });
      extra = r2(extra - due);
    } else {
      change.reduced.push({ id: i.id, seq: i.seq, from: due, to: r2(due - extra) });
      extra = 0;
    }
  }
  return change;
}

/** "₹1,21,540" (paise only when there are any). */
export function rupees(n: number): string {
  return `₹${r2(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** What the payment does to the plan, in sentences for the dialog. Empty when it's paid exactly. */
export function describePlanChange(change: PlanChange): string[] {
  const out: string[] = [];
  if (change.rest) {
    out.push(`${rupees(change.rest.amount)} stays due on ${formatEnrollDate(change.rest.expectedDate)} as instalment ${change.rest.seq}.`);
  }
  for (const c of change.covered) out.push(`Also pays instalment ${c.seq} (${rupees(c.amount)}) in full.`);
  for (const r of change.reduced) out.push(`Also pays ${rupees(r.from - r.to)} of instalment ${r.seq}, leaving ${rupees(r.to)} due.`);
  return out;
}

export function planChangeProblemMessage(p: PlanChangeProblem): string {
  switch (p.error) {
    case "collection_not_due":
      return "This instalment has already been received or cancelled.";
    case "invalid_amount":
      return "Enter the amount received.";
    case "collection_more_than_due":
      return `That's more than the ${rupees(p.maxAmount)} still due on this plan. Add an instalment for the extra first.`;
  }
}
