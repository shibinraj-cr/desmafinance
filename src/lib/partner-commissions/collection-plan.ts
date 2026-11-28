/**
 * The collection plan a sent Partner Commissions invoice should have. Pure, so
 * the shape can be unit-tested; plan-sync.ts writes it.
 *
 * Collection plans are in rupees and the invoice is in AUD, so the money still
 * due is an estimate: the open AUD × the rupees per AUD the partner's recent
 * approved payments actually brought in. Each approved payment becomes a
 * received instalment at its real INR value, so the plan ends at what landed.
 */
import { round2 } from "./logic";

/**
 * Used only when no payment from any partner has been approved yet, so there
 * is no real rate to go by. The instalment says it is a rough estimate.
 */
export const FALLBACK_AUD_INR = 55;

/** Days to pay from the invoice's payment term: "Net 30" / "30 days" → 30; "Immediate" or anything else → 0. */
export function termDays(paymentTerm: string | null | undefined): number {
  const t = (paymentTerm ?? "").trim();
  const m = /\bnet\s*(\d{1,3})\b/i.exec(t) ?? /\b(\d{1,3})\s*days?\b/i.exec(t);
  return m ? Math.min(365, Number(m[1])) : 0;
}

/** Rupees per AUD across these approved payments (what actually landed), or null when there are none. */
export function rateFromReceipts(receipts: Array<{ audSettled: number; inrAmount: number }>): number | null {
  const ok = receipts.filter((r) => r.audSettled > 0 && r.inrAmount > 0);
  const aud = ok.reduce((s, r) => s + r.audSettled, 0);
  const inr = ok.reduce((s, r) => s + r.inrAmount, 0);
  return aud > 0 ? Math.round((inr / aud) * 100) / 100 : null;
}

const addDaysIso = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const aud = (n: number) => `AUD ${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const aed = (n: number) => `AED ${n.toLocaleString("en-AU", { maximumFractionDigits: 2 })}`;

export type CommissionPlanInput = {
  invoice: {
    status: string;
    /** The day it was marked sent, in India (YYYY-MM-DD). */
    sentOn: string;
    paymentTerm: string;
    totalAud: number;
  };
  /** Approved payments only. */
  approved: Array<{
    receivedOn: string;
    audSettled: number;
    aedAmount: number;
    inrAmount: number;
    settleInFull: boolean;
    skipLedger: boolean;
    /** The first Revenue row it posted (null when it posted none). */
    transactionId: string | null;
  }>;
  /** Rupees per AUD for what is still open; null = no history (FALLBACK_AUD_INR). */
  rate: number | null;
};

export type CommissionPlanRow = {
  seq: number;
  expectedDate: string;
  amount: number;
  status: "pending" | "received" | "cancelled";
  transactionId: string | null;
  description: string;
};

export type CommissionPlanShape = {
  status: "active" | "closed" | "cancelled";
  rows: CommissionPlanRow[];
};

/**
 * One received instalment per approved payment (oldest first), then one due
 * instalment for whatever AUD is still open, expected on the sent date plus
 * the payment term. A cancelled invoice keeps its one instalment, cancelled.
 */
export function commissionPlanShape(input: CommissionPlanInput): CommissionPlanShape {
  const { invoice } = input;
  const rate = input.rate ?? FALLBACK_AUD_INR;
  const rateNote = input.rate == null ? `rough estimate at ₹${rate}/AUD, no payment approved yet` : `estimate at ₹${rate}/AUD from recent payments`;
  const due = addDaysIso(invoice.sentOn, termDays(invoice.paymentTerm));

  if (invoice.status === "cancelled") {
    return {
      status: "cancelled",
      rows: [
        {
          seq: 1,
          expectedDate: due,
          amount: Math.max(1, Math.round(invoice.totalAud * rate)),
          status: "cancelled",
          transactionId: null,
          description: `Invoice cancelled · ${aud(invoice.totalAud)}`,
        },
      ],
    };
  }

  const approved = [...input.approved].sort((a, b) => a.receivedOn.localeCompare(b.receivedOn));
  const rows: CommissionPlanRow[] = approved.map((r, i) => ({
    seq: i + 1,
    expectedDate: r.receivedOn,
    amount: round2(r.inrAmount),
    status: "received",
    transactionId: r.transactionId,
    description:
      `${aud(r.audSettled)} settled` +
      (r.aedAmount > 0 ? ` · ${aed(r.aedAmount)} received` : "") +
      (r.skipLedger ? " · already in the ledger" : ""),
  }));

  const settledAud = approved.reduce((s, r) => s + r.audSettled, 0);
  const closedEarly = approved.some((r) => r.settleInFull);
  const openAud = invoice.status === "paid" || closedEarly ? 0 : Math.max(0, round2(invoice.totalAud - settledAud));
  if (openAud > 0) {
    rows.push({
      seq: rows.length + 1,
      expectedDate: due,
      amount: Math.max(1, Math.round(openAud * rate)),
      status: "pending",
      transactionId: null,
      description: `${aud(openAud)} due · ${rateNote}`,
    });
  }
  return { status: openAud > 0 ? "active" : "closed", rows };
}
