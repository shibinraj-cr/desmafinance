/**
 * Bank reconciliation rules (src/lib/bank/reconcile.ts): what is matched
 * without a person (an exact reference with the exact open amount, one entry
 * carrying it), what is only suggested, part payments, transfers between
 * DesGro's own accounts, ₹1 test credits, and how a line with no ledger entry
 * is pre-booked from the last one like it. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import {
  autoMatchFor,
  autoTransferFor,
  isTestCredit,
  narrationSignature,
  normRef,
  rankLedger,
  rankTransfers,
  referencesOf,
  suggestBooking,
  tokensOf,
  type BankLine,
  type LedgerEntry,
  type PastBooking,
} from "@/lib/bank/reconcile";

const line = (over: Partial<BankLine> = {}): BankLine => ({
  id: "b1",
  integrationId: "axis",
  bankCode: "AXIS",
  accountLastFour: "1234",
  direction: "CREDIT",
  amount: 3422000,
  txnDate: "2026-11-10",
  description: "UPI/P2A/612345678901/TEST CANDIDATE/AXISBANK/fee",
  references: ["612345678901"],
  ...over,
});
const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: "t1",
  date: "2026-11-10",
  type: "Revenue",
  amount: 3422000,
  matched: 0,
  description: "Enrollment first payment · UTR 612345678901 · paid by candidate",
  counterparty: "Test Candidate",
  paymentMode: "Axis Bank",
  ...over,
});

describe("references", () => {
  it("compares references without punctuation or leading zeros", () => {
    expect(normRef("0000612345678901")).toBe("612345678901");
    expect(normRef("HDFC-N520261112")).toBe("HDFCN520261112");
    expect(normRef("12345")).toBeNull();
    expect(normRef("ABCDEFGH")).toBeNull();
  });

  it("collects a line's reference fields and the ids in its narration", () => {
    expect(
      referencesOf({ referenceNumber: "0000612345678901", upiReference: null, bankReference: "HDFCN52026111234", description: "NEFT CR-HDFC0000001-TEST PARENT-HDFCN52026111234" }).sort(),
    ).toEqual(["612345678901", "HDFCN52026111234"].sort());
    expect(tokensOf("Fee for course · UTR 612345678901 · Ref AXIS/2026")).toEqual(["612345678901"]);
  });
});

describe("matching a bank line to the ledger", () => {
  it("matches on its own only an exact reference with the exact amount", () => {
    const ranked = rankLedger(line(), [entry()]);
    expect(ranked[0]).toMatchObject({ id: "t1", refMatch: true, exact: true });
    expect(ranked[0].reasons).toEqual(expect.arrayContaining(["Exact amount", "Reference 612345678901 in the ledger entry", "Same date", "Booked as Axis Bank"]));
    expect(autoMatchFor(line(), ranked)?.id).toBe("t1");
  });

  it("only suggests an exact amount without the reference", () => {
    const ranked = rankLedger(line(), [entry({ description: "Course fee" })]);
    expect(ranked[0].score).toBeGreaterThanOrEqual(55);
    expect(autoMatchFor(line(), ranked)).toBeNull();
  });

  it("only suggests when two entries carry the reference, or the amount differs", () => {
    expect(autoMatchFor(line(), rankLedger(line(), [entry(), entry({ id: "t2" })]))).toBeNull();
    expect(autoMatchFor(line(), rankLedger(line(), [entry({ amount: 3500000 })]))).toBeNull();
  });

  it("offers the open part of an entry paid in two transfers", () => {
    // ₹34,220 booked once; ₹20,000 already tied to the first transfer.
    const ranked = rankLedger(line({ amount: 1422000 }), [entry({ matched: 2000000 })]);
    expect(ranked[0]).toMatchObject({ exact: true, open: 1422000 });
    expect(ranked[0].reasons).toContain("Exactly what is still open");
    // A first transfer of ₹20,000 is "part of a larger entry".
    expect(rankLedger(line({ amount: 2000000 }), [entry()])[0].reasons).toContain("Part of a larger entry");
  });

  it("never offers the wrong side, a fully matched entry, or one a month away without a reference", () => {
    expect(rankLedger(line(), [entry({ type: "Expense" })])).toEqual([]);
    expect(rankLedger(line(), [entry({ matched: 3422000 })])).toEqual([]);
    expect(rankLedger(line(), [entry({ date: "2026-10-01", description: "Course fee" })])).toEqual([]);
    // With the reference, up to 30 days apart.
    expect(rankLedger(line(), [entry({ date: "2026-10-20" })])).toHaveLength(1);
  });

  it("marks down an entry booked against the other bank", () => {
    const [own] = rankLedger(line(), [entry({ description: "Course fee" })]);
    const [other] = rankLedger(line(), [entry({ description: "Course fee", paymentMode: "HDFC Bank" })]);
    expect(other.score).toBe(own.score - 40);
    expect(other.reasons).toContain("Booked as HDFC Bank, not this bank");
  });
});

describe("transfers between DesGro's accounts", () => {
  const out = line({ id: "h1", integrationId: "hdfc", bankCode: "HDFC", accountLastFour: "9302", direction: "DEBIT", amount: 50000000, description: "NEFT DR-UTIB0000001-TEST COMPANY-HDFCN52026111234", references: ["HDFCN52026111234"] });
  const into = line({ id: "a1", amount: 50000000, txnDate: "2026-11-11", description: "NEFT/HDFCN52026111234/TEST COMPANY/HDFC BANK", references: ["HDFCN52026111234"] });

  it("pairs on its own the leg with the same reference", () => {
    const ranked = rankTransfers(out, [into]);
    expect(ranked[0]).toMatchObject({ id: "a1", refMatch: true });
    expect(autoTransferFor(ranked)?.id).toBe("a1");
  });

  it("only suggests a same-amount leg without the reference", () => {
    const ranked = rankTransfers(out, [{ ...into, references: [] }]);
    expect(ranked[0]?.id).toBe("a1");
    expect(autoTransferFor(ranked)).toBeNull();
  });

  it("never pairs within one account, the same side, another amount, or days apart", () => {
    expect(rankTransfers(out, [{ ...into, integrationId: "hdfc" }])).toEqual([]);
    expect(rankTransfers(out, [{ ...into, direction: "DEBIT" }])).toEqual([]);
    expect(rankTransfers(out, [{ ...into, amount: 49999900 }])).toEqual([]);
    expect(rankTransfers(out, [{ ...into, txnDate: "2026-11-20" }])).toEqual([]);
  });
});

describe("what is never a payment reference", () => {
  it("leaves out phone numbers, masked accounts, PAN, GSTIN and short ids", () => {
    expect(tokensOf("UPI/P2A/612345678901/TEST PAYER 9876543210@YBL/XXXXXXXX1234/ABCDE1234F/32ABCDE1234F1Z5/000000987654")).toEqual(["612345678901"]);
    expect(referencesOf({ referenceNumber: "9876543210", upiReference: null, bankReference: null, description: "ACH/D/TEST AUTO FINANCE/000000987654" })).toEqual([]);
  });
});

describe("transfer suggestions need more than a matching amount", () => {
  const out = line({ id: "v", integrationId: "hdfc", bankCode: "HDFC", accountLastFour: "9302", direction: "DEBIT", amount: 700000, description: "NEFT DR-HDFC0000001-ACME PRINTERS-HDFCN520261199999", references: ["HDFCN520261199999"] });
  const into = line({ id: "c", amount: 700000, txnDate: "2026-11-11", description: "NEFT/AXISN52026111888877/ZETA LEARNER/HDFC BANK", references: ["AXISN52026111888877"] });
  it("doesn't pair a vendor payment with an unrelated receipt of the same amount", () => {
    expect(rankTransfers(out, [into])).toEqual([]);
  });
  it("never reads the other account's number inside a longer number", () => {
    const tricky = { ...into, description: "NEFT/AXISN52026119302777/ZETA LEARNER/HDFC BANK" };
    expect(rankTransfers(out, [tricky])).toEqual([]);
  });
});

describe("test credits", () => {
  it("are credits of ₹10 or less", () => {
    expect(isTestCredit({ direction: "CREDIT", amount: 100 })).toBe(true);
    expect(isTestCredit({ direction: "CREDIT", amount: 1000 })).toBe(true);
    expect(isTestCredit({ direction: "CREDIT", amount: 1001 })).toBe(false);
    expect(isTestCredit({ direction: "DEBIT", amount: 100 })).toBe(false);
  });
});

describe("booking a line that has no ledger entry", () => {
  it("recognises the same kind of line across months: names and numbers taken out", () => {
    expect(narrationSignature("ACH/D/TEST AUTO FINANCE/000000123456")).toBe("ACH TEST AUTO FINANCE");
    expect(narrationSignature("ACH/D/TEST AUTO FINANCE/000000987654")).toBe("ACH TEST AUTO FINANCE");
  });

  it("books it like the last one of its kind, the closest amount first", () => {
    const emi = line({ direction: "DEBIT", amount: 9084400, description: "ACH/D/TEST AUTO FINANCE/000000987654", references: [] });
    const past: PastBooking[] = [
      { signature: "ACH TEST AUTO FINANCE", amount: 9084400, type: "Expense", category: "Loan Repayment", subItem: "Vehicle loan EMI", partyId: "p1", employeeId: null, date: "2026-10-04" },
      { signature: "ACH TEST AUTO FINANCE", amount: 100000, type: "Expense", category: "Bank Charges", subItem: "Bounce charge", partyId: null, employeeId: null, date: "2026-10-20" },
      { signature: "ACH TEST AUTO FINANCE", amount: 9084400, type: "Revenue", category: "Refund", subItem: "x", partyId: null, employeeId: null, date: "2026-10-04" },
    ];
    expect(suggestBooking(emi, past)).toMatchObject({ category: "Loan Repayment", subItem: "Vehicle loan EMI", partyId: "p1" });
    expect(suggestBooking({ ...emi, description: "NEFT/X/OTHER" }, past)).toBeNull();
  });
});
