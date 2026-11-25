import { describe, expect, it } from "vitest";
import {
  FALLBACK_AUD_INR,
  commissionPlanShape,
  rateFromReceipts,
  termDays,
  type CommissionPlanInput,
} from "@/lib/partner-commissions/collection-plan";

const base = (over: Partial<CommissionPlanInput["invoice"]> = {}): CommissionPlanInput["invoice"] => ({
  status: "sent",
  sentOn: "2026-11-25",
  paymentTerm: "Immediate",
  totalAud: 12192.5,
  ...over,
});

const receipt = (over: Partial<CommissionPlanInput["approved"][number]> = {}): CommissionPlanInput["approved"][number] => ({
  receivedOn: "2026-11-28",
  audSettled: 6000,
  aedAmount: 14400,
  inrAmount: 330000,
  settleInFull: false,
  skipLedger: false,
  transactionId: "tx1",
  ...over,
});

describe("termDays", () => {
  it("reads Net N and N days, else pays immediately", () => {
    expect(termDays("Immediate")).toBe(0);
    expect(termDays("Net 30")).toBe(30);
    expect(termDays("net15")).toBe(15);
    expect(termDays("14 days")).toBe(14);
    expect(termDays("Within 7 days of invoice")).toBe(7);
    expect(termDays("")).toBe(0);
    expect(termDays(null)).toBe(0);
    expect(termDays("On receipt")).toBe(0);
  });
});

describe("rateFromReceipts", () => {
  it("is the rupees per AUD that actually landed", () => {
    expect(rateFromReceipts([{ audSettled: 1000, inrAmount: 55000 }, { audSettled: 3000, inrAmount: 168000 }])).toBe(55.75);
  });
  it("is null with no usable payment", () => {
    expect(rateFromReceipts([])).toBeNull();
    expect(rateFromReceipts([{ audSettled: 0, inrAmount: 100 }])).toBeNull();
  });
});

describe("commissionPlanShape", () => {
  it("a sent invoice is one instalment due on the sent date, in rupees", () => {
    const s = commissionPlanShape({ invoice: base(), approved: [], rate: 55.2 });
    expect(s.status).toBe("active");
    expect(s.rows).toEqual([
      expect.objectContaining({ seq: 1, expectedDate: "2026-11-25", amount: Math.round(12192.5 * 55.2), status: "pending", transactionId: null }),
    ]);
    expect(s.rows[0].description).toContain("AUD 12,192.50 due");
    expect(s.rows[0].description).toContain("₹55.2/AUD");
  });

  it("the payment term moves the due date (across a month end)", () => {
    const s = commissionPlanShape({ invoice: base({ paymentTerm: "Net 30", sentOn: "2026-11-25" }), approved: [], rate: 55 });
    expect(s.rows[0].expectedDate).toBe("2026-12-25");
  });

  it("with no payment history it says the amount is a rough estimate", () => {
    const s = commissionPlanShape({ invoice: base({ totalAud: 100 }), approved: [], rate: null });
    expect(s.rows[0].amount).toBe(100 * FALLBACK_AUD_INR);
    expect(s.rows[0].description).toContain("rough estimate");
  });

  it("a part payment is received at its real INR, the rest stays due", () => {
    const s = commissionPlanShape({ invoice: base({ status: "partpaid", totalAud: 10000 }), approved: [receipt()], rate: 55 });
    expect(s.status).toBe("active");
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toEqual(expect.objectContaining({ seq: 1, status: "received", amount: 330000, expectedDate: "2026-11-28", transactionId: "tx1" }));
    expect(s.rows[1]).toEqual(expect.objectContaining({ seq: 2, status: "pending", amount: 4000 * 55, expectedDate: "2026-11-25" }));
  });

  it("paid closes the plan with only received instalments, oldest first", () => {
    const s = commissionPlanShape({
      invoice: base({ status: "paid", totalAud: 10000 }),
      approved: [
        receipt({ receivedOn: "2026-12-10", audSettled: 4000, inrAmount: 220000, transactionId: "tx2" }),
        receipt({ receivedOn: "2026-11-28", transactionId: "tx1" }),
      ],
      rate: 55,
    });
    expect(s.status).toBe("closed");
    expect(s.rows.map((r) => [r.seq, r.status, r.transactionId])).toEqual([
      [1, "received", "tx1"],
      [2, "received", "tx2"],
    ]);
  });

  it("settled in full short of the total (bank charges) leaves nothing due", () => {
    const s = commissionPlanShape({
      invoice: base({ status: "paid", totalAud: 10000 }),
      approved: [receipt({ audSettled: 9950, settleInFull: true })],
      rate: 55,
    });
    expect(s.status).toBe("closed");
    expect(s.rows.every((r) => r.status === "received")).toBe(true);
  });

  it("a payment already in the ledger is received without a ledger link", () => {
    const s = commissionPlanShape({
      invoice: base({ status: "paid", totalAud: 6000 }),
      approved: [receipt({ skipLedger: true, transactionId: null })],
      rate: 55,
    });
    expect(s.rows[0]).toEqual(expect.objectContaining({ status: "received", transactionId: null }));
    expect(s.rows[0].description).toContain("already in the ledger");
  });

  it("awaiting approval keeps the open amount due until it is approved", () => {
    const s = commissionPlanShape({ invoice: base({ status: "awaiting", totalAud: 1000 }), approved: [], rate: 56 });
    expect(s.rows).toEqual([expect.objectContaining({ status: "pending", amount: 56000 })]);
  });

  it("cancelled keeps one cancelled instalment and cancels the plan", () => {
    const s = commissionPlanShape({ invoice: base({ status: "cancelled", totalAud: 1000 }), approved: [], rate: 56 });
    expect(s.status).toBe("cancelled");
    expect(s.rows).toEqual([expect.objectContaining({ status: "cancelled", amount: 56000 })]);
  });
});
