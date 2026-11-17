/**
 * The Enroll sheet's rules (src/lib/crm-enroll-confirm.ts): the balance split,
 * what the sheet refuses, the first-payment minimum and its exception, the
 * change log Finance's edits produce, and when an enrolment counts for the
 * incentive.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_FIRST_PAYMENT,
  addMonths,
  approveBlocker,
  belowMinimum,
  changeSummary,
  confirmProblems,
  enrollmentChanges,
  financeProblems,
  incentiveCutoff,
  incentiveStanding,
  nextException,
  parsePlan,
  splitBalance,
  suggestedExpDom,
  utrRequired,
  type EnrollConfirm,
  type EnrollmentFields,
} from "@/lib/crm-enroll-confirm";

const TODAY = "2026-11-17";
const sheet = (over: Partial<EnrollConfirm> = {}): EnrollConfirm => ({
  billingName: "Test Candidate",
  billingCountry: "India",
  billingState: "Kerala",
  billingAddress: null,
  billingPin: null,
  totalAmount: 121540,
  firstAmount: 34220,
  paidOn: "2026-11-10",
  paymentMode: "Axis Bank",
  utr: "AXIS123456",
  payerRelation: "candidate",
  payerName: null,
  plan: [
    { date: "2026-12-10", amount: 43660 },
    { date: "2027-01-10", amount: 43660 },
  ],
  ...over,
});
const problems = (c: EnrollConfirm, canBackdate = false) =>
  confirmProblems(c, { today: TODAY, canBackdate, dateWindow: true }).map((p) => `${p.field}: ${p.message}`);

describe("the balance plan", () => {
  it("splits evenly in whole rupees, the last instalment taking the rest", () => {
    expect(splitBalance(87321, 3, "2026-11-10")).toEqual([
      { date: "2026-12-10", amount: 29107 },
      { date: "2027-01-10", amount: 29107 },
      { date: "2027-02-10", amount: 29107 },
    ]);
    expect(splitBalance(100000, 3, "2026-11-10").map((r) => r.amount)).toEqual([33333, 33333, 33334]);
    expect(splitBalance(0, 2, "2026-11-10")).toEqual([]);
  });

  it("lands month-end dates on the shorter month's last day", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("drops malformed stored rows", () => {
    expect(parsePlan([{ date: "2026-12-01", amount: 100 }, { date: "bad", amount: 5 }, { date: "2026-12-02", amount: 0 }, null])).toEqual([
      { date: "2026-12-01", amount: 100 },
    ]);
    expect(parsePlan("nope")).toEqual([]);
  });
});

describe("what the sheet refuses", () => {
  it("accepts a complete, consistent sheet", () => {
    expect(problems(sheet())).toEqual([]);
  });

  it("needs the passport name, and an Indian state for GST", () => {
    expect(problems(sheet({ billingName: " " }))[0]).toMatch(/^billingName/);
    expect(problems(sheet({ billingState: null }))[0]).toMatch(/^billingState: Pick the candidate's state/);
    // Abroad: no state.
    expect(problems(sheet({ billingCountry: "Canada", billingState: null }))).toEqual([]);
  });

  it("keeps the first payment within the total, and dates within the enrollment window", () => {
    expect(problems(sheet({ firstAmount: 200000 }))).toContain("firstAmount: The first payment can't be more than the total.");
    expect(problems(sheet({ paidOn: "2026-11-18" }))).toContain("paidOn: The payment date can't be in the future.");
    expect(problems(sheet({ paidOn: "2026-10-31", plan: [{ date: "2026-12-10", amount: 87320 }] }))[0]).toMatch(/^paidOn: Enrollments can be dated from 1 Nov 2026/);
    expect(problems(sheet({ paidOn: "2026-10-31", plan: [{ date: "2026-12-10", amount: 87320 }] }), true)).toEqual([]);
  });

  it("needs the UTR for a bank or UPI payment, not for cash", () => {
    expect(problems(sheet({ utr: null }))).toContain("utr: Enter the UTR: the bank reference on the payment screenshot.");
    expect(problems(sheet({ paymentMode: "Cash", utr: null }))).toEqual([]);
    expect(utrRequired("UPI")).toBe(true);
    expect(utrRequired("Credit Card")).toBe(false);
  });

  it("needs the payer's name when someone else paid", () => {
    expect(problems(sheet({ payerRelation: "parent" }))).toContain("payerName: Enter the name of the person who paid.");
    expect(problems(sheet({ payerRelation: "parent", payerName: "A Parent" }))).toEqual([]);
  });

  it("makes the plan add up to the balance, after the first payment", () => {
    expect(problems(sheet({ plan: [] }))).toContain("plan: Plan the balance of ₹87,320: pick 1, 2 or 3 instalments.");
    expect(problems(sheet({ plan: [{ date: "2026-12-10", amount: 80000 }] }))).toContain(
      "plan: The instalments add up to ₹80,000, but the balance is ₹87,320.",
    );
    expect(problems(sheet({ plan: [{ date: "2026-11-01", amount: 87320 }] }))).toContain("plan: Instalment 2 is dated before the first payment.");
    // Paid in full: nothing to plan.
    expect(problems(sheet({ firstAmount: 121540, plan: [] }))).toEqual([]);
  });
});

describe("the first-payment minimum", () => {
  it(`is ₹${MIN_FIRST_PAYMENT.toLocaleString("en-IN")}`, () => {
    expect(belowMinimum(9999)).toBe(true);
    expect(belowMinimum(10000)).toBe(false);
    expect(belowMinimum(null)).toBe(false);
  });

  it("asks the sales head again unless an approval still covers the amount", () => {
    expect(nextException(null, 34220, 5000)).toBe("pending");
    expect(nextException("approved", 5000, 6000)).toBe("approved");
    expect(nextException("approved", 5000, 4000)).toBe("pending");
    expect(nextException("rejected", 5000, 5000)).toBe("rejected");
    expect(nextException("rejected", 5000, 7000)).toBe("pending");
    expect(nextException("pending", 5000, 12000)).toBe(null);
  });
});

const fields = (over: Partial<EnrollmentFields> = {}): EnrollmentFields => ({ ...sheet(), ...over });

describe("Finance's review", () => {
  it("logs what changed as 'from → to', BDE-readable", () => {
    const changes = enrollmentChanges(fields(), fields({ totalAmount: 120000, utr: "AXIS999", plan: [{ date: "2026-12-10", amount: 85780 }] }));
    expect(changeSummary(changes)).toBe(
      "Total: ₹1,21,540 → ₹1,20,000; UTR: AXIS123456 → AXIS999; Balance plan: ₹43,660 on 10 Dec 2026; ₹43,660 on 10 Jan 2027 → ₹85,780 on 10 Dec 2026",
    );
    // Finance's own fields only when the new version has them.
    expect(enrollmentChanges(fields(), fields({ category: "Sales", expDom: "DOM" })).map((c) => c.field)).toEqual(["category", "expDom"]);
    expect(enrollmentChanges(fields(), fields())).toEqual([]);
  });

  it("accepts an older app's enrollment with no payment yet, but checks one once it's there", () => {
    const legacy = fields({ firstAmount: null, paidOn: null, paymentMode: null, utr: null, payerRelation: null, plan: [] });
    expect(financeProblems(legacy, TODAY)).toEqual([]);
    expect(financeProblems({ ...legacy, firstAmount: 30000 }, TODAY)).toEqual(["The instalments add up to ₹0, but the balance is ₹91,540."]);
  });

  it("can't approve until the payment, the classification and EXP/DOM are set, nor past the sales head", () => {
    const ready = { ...fields({ category: "Sales - Nursing Registrations", subItem: "AHPRA OBA Pathway (Sales)", expDom: "DOM" }), status: "pending", exception: null };
    expect(approveBlocker(ready)).toBeNull();
    expect(approveBlocker({ ...ready, expDom: null })).toBe("Pick EXP or DOM.");
    expect(approveBlocker({ ...ready, category: null })).toBe("Pick the ledger category and sub-item.");
    expect(approveBlocker({ ...ready, firstAmount: null })).toMatch(/^Fill in the first payment/);
    expect(approveBlocker({ ...ready, exception: "pending" })).toMatch(/sales head has to approve/);
    expect(approveBlocker({ ...ready, exception: "rejected" })).toMatch(/rejected/);
    expect(approveBlocker({ ...ready, exception: "approved" })).toBeNull();
    expect(approveBlocker({ ...ready, status: "verified" })).toMatch(/already verified/);
  });

  it("suggests DOM for an Indian candidate and EXP for one abroad; Wio is always DOM", () => {
    expect(suggestedExpDom("India", "Axis Bank")).toBe("DOM");
    expect(suggestedExpDom("Canada", "Axis Bank")).toBe("EXP");
    expect(suggestedExpDom("Canada", "Wio Bank")).toBe("DOM");
  });
});

describe("the incentive", () => {
  it("cuts off at the end of the 7th of the next month, IST", () => {
    expect(incentiveCutoff(2026, 11).toISOString()).toBe("2026-12-07T18:29:59.999Z");
    expect(incentiveCutoff(2026, 12).toISOString()).toBe("2027-01-07T18:29:59.999Z");
  });

  it("counts verified-by-the-cut-off and pre-verification deals; reports the rest", () => {
    const cutoff = incentiveCutoff(2026, 11);
    const before = new Date("2026-12-05T10:00:00Z");
    const after = new Date("2026-12-09T10:00:00Z");
    expect(incentiveStanding(null, cutoff, after)).toBe("counted");
    expect(incentiveStanding({ status: "verified", verifiedAt: new Date("2026-12-07T15:00:00Z") }, cutoff, after)).toBe("counted");
    expect(incentiveStanding({ status: "verified", verifiedAt: new Date("2026-12-08T03:00:00Z") }, cutoff, after)).toBe("late");
    expect(incentiveStanding({ status: "pending", verifiedAt: null }, cutoff, before)).toBe("awaiting");
    expect(incentiveStanding({ status: "sent_back", verifiedAt: null }, cutoff, after)).toBe("missed");
  });
});
