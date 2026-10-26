import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  amountInWords,
  balanceOf,
  canTrackEnrollment,
  checkInstallment,
  commissionOf,
  defaultLineDescription,
  enrollablePrograms,
  enrollmentState,
  fmtInvoiceNumber,
  fullyPaidOn,
  fyLabel,
  intakeMonthOptions,
  looksLikeSeries,
  nextRunDate,
  numberToWords,
  openAud,
  runDue,
  splitByProgram,
  statusAfterApproval,
  statusAfterReturn,
  suggestInvoiceNumber,
} from "@/lib/partner-commissions/logic";
import { PROGRAM_CODES } from "@/lib/partner-commissions/constants";
import { buildInvoicePdf, type InvoicePdfData } from "@/lib/partner-commissions/pdf";

describe("amount in words (matches DESMA's invoices)", () => {
  it("writes whole amounts the way the samples do", () => {
    expect(amountInWords(7060)).toBe("AUD Seven Thousand Sixty");
    expect(amountInWords(1600)).toBe("AUD One Thousand Six Hundred");
    expect(numberToWords(1580)).toBe("One Thousand Five Hundred Eighty");
    expect(numberToWords(460)).toBe("Four Hundred Sixty");
  });
  it("handles compound tens, cents, zero and millions", () => {
    expect(numberToWords(2345.5)).toBe("Two Thousand Three Hundred Forty-Five and Fifty Cents");
    expect(numberToWords(0)).toBe("Zero");
    expect(numberToWords(1_000_001)).toBe("One Million One");
  });
  it("prints invoice numbers without separators, like the template", () => {
    expect(fmtInvoiceNumber(7060)).toBe("7060");
    expect(fmtInvoiceNumber(1234.5)).toBe("1234.50");
  });
});

describe("course fee and installments", () => {
  const fee = 2300;
  it("computes commission and balance", () => {
    expect(commissionOf(2300, 20)).toBe(460);
    expect(commissionOf(8000, 10)).toBe(800);
    expect(balanceOf(fee, [{ amount: 1000 }, { amount: 500 }])).toBe(800);
    expect(balanceOf(fee, [{ amount: 2300 }])).toBe(0);
  });
  it("refuses an installment over the balance, a 4th installment, or a future date", () => {
    const today = "2026-10-20";
    expect(checkInstallment({ courseFee: fee, payments: [{ amount: 2000 }], amount: 301, paidOn: today, today })).toMatch(/more than the balance/);
    expect(checkInstallment({ courseFee: fee, payments: [{ amount: 1 }, { amount: 1 }, { amount: 1 }], amount: 1, paidOn: today, today })).toMatch(/All 3/);
    expect(checkInstallment({ courseFee: fee, payments: [], amount: 100, paidOn: "2026-10-21", today })).toMatch(/future/);
    expect(checkInstallment({ courseFee: fee, payments: [], amount: 0, paidOn: today, today })).toMatch(/amount/);
    expect(checkInstallment({ courseFee: fee, payments: [{ amount: 2000 }], amount: 300, paidOn: today, today })).toBeNull();
  });
  it("dates full payment to the installment that cleared the balance", () => {
    expect(fullyPaidOn(fee, [{ amount: 1300, paidOn: "2026-08-01" }, { amount: 1000, paidOn: "2026-10-05" }])).toBe("2026-10-05");
    expect(fullyPaidOn(fee, [{ amount: 1300, paidOn: "2026-08-01" }])).toBeNull();
    expect(fullyPaidOn(fee, [])).toBeNull();
  });
  it("derives the state an enrollment is shown in", () => {
    const base = { status: "active", courseFee: fee, invoiceStatus: null };
    expect(enrollmentState({ ...base, payments: [] })).toBe("notstarted");
    expect(enrollmentState({ ...base, payments: [{ amount: 100 }] })).toBe("paying");
    expect(enrollmentState({ ...base, payments: [{ amount: 2300 }] })).toBe("fullypaid");
    expect(enrollmentState({ ...base, payments: [{ amount: 2300 }], invoiceStatus: "sent" })).toBe("invoiced");
    expect(enrollmentState({ ...base, payments: [{ amount: 2300 }], invoiceStatus: "paid" })).toBe("received");
    expect(enrollmentState({ ...base, status: "withdrawn", payments: [] })).toBe("withdrawn");
  });
});

describe("invoice numbering", () => {
  it("labels the Indian financial year (April–March)", () => {
    expect(fyLabel("2026-10-20")).toBe("26-27");
    expect(fyLabel("2027-03-31")).toBe("26-27");
    expect(fyLabel("2027-04-01")).toBe("27-28");
  });
  it("suggests one above the highest number in the year's series", () => {
    const existing = ["D/DLLC/26-27/012", "D/DLLC/26-27/019", "D/DLLC/25-26/044", "custom-1"];
    expect(suggestInvoiceNumber("D/DLLC/", "2026-10-20", existing)).toBe("D/DLLC/26-27/020");
    expect(suggestInvoiceNumber("D/DLLC/", "2027-04-02", existing)).toBe("D/DLLC/27-28/001");
  });
  it("never suggests below the Next invoice number setting in its financial year", () => {
    const floor = "D/DLLC/26-27/025";
    // Nothing in DesGro yet: 001–024 were raised outside it.
    expect(suggestInvoiceNumber("D/DLLC/", "2026-10-20", [], floor)).toBe("D/DLLC/26-27/025");
    // DesGro invoices below the floor don't pull the suggestion down…
    expect(suggestInvoiceNumber("D/DLLC/", "2026-10-20", ["D/DLLC/26-27/012"], floor)).toBe("D/DLLC/26-27/025");
    // …and once DesGro has made 025 and 026 it moves on by itself.
    expect(suggestInvoiceNumber("D/DLLC/", "2026-11-20", ["D/DLLC/26-27/025", "D/DLLC/26-27/026"], floor)).toBe("D/DLLC/26-27/027");
    // A new financial year starts again at 001.
    expect(suggestInvoiceNumber("D/DLLC/", "2027-04-20", ["D/DLLC/26-27/031"], floor)).toBe("D/DLLC/27-28/001");
    // A floor from another series is ignored.
    expect(suggestInvoiceNumber("D/DLLC/", "2026-10-20", [], "INV/26-27/900")).toBe("D/DLLC/26-27/001");
  });
  it("recognises the series shape", () => {
    expect(looksLikeSeries("D/DLLC/", "D/DLLC/26-27/012")).toBe(true);
    expect(looksLikeSeries("D/DLLC/", "INV-12")).toBe(false);
  });
});

describe("monthly run timing", () => {
  it("runs on or after the run day, once a month", () => {
    expect(runDue("2026-10-19", 20, false)).toBe(false);
    expect(runDue("2026-10-20", 20, false)).toBe(true);
    expect(runDue("2026-10-22", 20, false)).toBe(true); // missed day catches up
    expect(runDue("2026-10-22", 20, true)).toBe(false);
  });
  it("shows the next run date", () => {
    expect(nextRunDate("2026-10-19", 20, false)).toBe("2026-10-20");
    expect(nextRunDate("2026-10-20", 20, true)).toBe("2026-11-20");
    expect(nextRunDate("2026-12-21", 20, true)).toBe("2027-01-20");
  });
});

describe("payments and Revenue posting", () => {
  // Sample invoice 012: 11 OSCE lines (26,300 fee) and 6 NCLEX lines (9,000), all at 20%.
  const lines = [
    { program: "OSCE", amount: 5260 },
    { program: "NCLEX", amount: 1800 },
  ];
  it("splits the INR across programs in proportion, adding up exactly", () => {
    const parts = splitByProgram(lines, 397997);
    expect(parts.map((p) => p.program)).toEqual(["NCLEX", "OSCE"]);
    expect(parts.reduce((s, p) => s + p.inr, 0)).toBe(397997);
    expect(parts.find((p) => p.program === "NCLEX")!.inr).toBe(Math.round((397997 * 1800) / 7060));
  });
  it("posts a single-program invoice as one row", () => {
    expect(splitByProgram([{ program: "GCAN", amount: 800 }, { program: "GCAN", amount: 800 }], 91489)).toEqual([{ program: "GCAN", inr: 91489, aud: 1600 }]);
  });
  it("tracks what is still open and the invoice status after review", () => {
    expect(openAud(1600, [{ status: "approved", audSettled: 1000 }, { status: "returned", audSettled: 600 }])).toBe(600);
    expect(statusAfterApproval({ total: 1600, approvedAud: 1000, settleInFull: false })).toBe("partpaid");
    expect(statusAfterApproval({ total: 1600, approvedAud: 1590, settleInFull: true })).toBe("paid");
    expect(statusAfterApproval({ total: 1600, approvedAud: 1600, settleInFull: false })).toBe("paid");
    expect(statusAfterReturn(0)).toBe("sent");
    expect(statusAfterReturn(500)).toBe("partpaid");
  });
});

describe("who can add enrollments", () => {
  const all = PROGRAM_CODES;
  it("gives Finance every program", () => {
    expect(enrollablePrograms({ isFinance: true, isBde: false, bdePrograms: [], grantPrograms: [], allPrograms: all })).toEqual(["NCLEX", "OSCE", "GCAN"]);
  });
  it("gives BDEs only GCAN by default", () => {
    expect(enrollablePrograms({ isFinance: false, isBde: true, bdePrograms: ["GCAN"], grantPrograms: [], allPrograms: all })).toEqual(["GCAN"]);
  });
  it("gives a named coordinator only OSCE and NCLEX", () => {
    expect(enrollablePrograms({ isFinance: false, isBde: false, bdePrograms: ["GCAN"], grantPrograms: ["OSCE", "NCLEX"], allPrograms: all })).toEqual(["NCLEX", "OSCE"]);
  });
  it("gives no one else anything", () => {
    expect(enrollablePrograms({ isFinance: false, isBde: false, bdePrograms: ["GCAN"], grantPrograms: [], allPrograms: all })).toEqual([]);
  });
});

describe("form helpers", () => {
  it("describes lines by partner layout", () => {
    expect(defaultLineDescription("compact", "Asha K", "OSCE")).toBe("Asha K | OSCE | Full Fee Paid");
    expect(defaultLineDescription("detailed", "Asha K", "GCAN")).toBe("Asha K");
  });
  it("offers intake months around today", () => {
    const m = intakeMonthOptions("2026-10-20");
    expect(m[0]).toBe("Oct-25");
    expect(m[12]).toBe("Oct-26");
    expect(m).toContain("Jan-27");
    expect(m[m.length - 1]).toBe("Apr-28");
  });
});

describe("invoice PDF", () => {
  const base: InvoicePdfData = {
    number: "D/DLLC/26-27/020",
    invoiceDate: "2026-10-20",
    paymentTerm: "Immediate",
    currency: "AUD",
    billTo: { name: "Partner Pty Ltd", address: "1 Example St\nSydney 2000", email: "billing@example.com", forLine: "Commission Payment" },
    layout: "compact",
    lines: Array.from({ length: 4 }, (_, i) => ({ description: `Candidate ${i} | OSCE | Full Fee Paid`, studentId: null, courseName: "OSCE", intakeMonth: "Nov-26", courseFee: 2500, commissionPct: 20, amount: 500 })),
    total: 2000,
    words: "AUD Two Thousand",
    issuer: { name: "Example International LLC", address: "Somewhere", regLine: "Reg 1" },
    bank: { accountName: "Example International LLC", currency: "AED", iban: "AE00 0000", bic: "XXXX", accountNo: "0000" },
    signatory: { name: "Authorised Signatory", image: null },
    logoPng: new Uint8Array(readFileSync(path.join(process.cwd(), "public", "desma-logo.png"))),
    fallbackFont: new Uint8Array(readFileSync(path.join(process.cwd(), "public", "fonts", "esign", "NotoSans-Regular.ttf"))),
  };
  it("builds a one-page invoice", async () => {
    const doc = await PDFDocument.load(await buildInvoicePdf(base));
    expect(doc.getPageCount()).toBe(1);
  });
  it("runs onto more pages for a long invoice, with names Helvetica can't encode", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({ ...base.lines[0], description: `Ŝṙeeja ${i} | OSCE | Full Fee Paid` }));
    const doc = await PDFDocument.load(await buildInvoicePdf({ ...base, layout: "detailed", lines, total: 30000 }));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});

describe("who records fee installments", () => {
  const coord = { isFinance: false, userId: "u_coord", grantPrograms: ["OSCE", "NCLEX"], bdePrograms: [] };
  const bde = { isFinance: false, userId: "u_bde", grantPrograms: [], bdePrograms: ["GCAN"] };
  const fin = { isFinance: true, userId: "u_fe", grantPrograms: [], bdePrograms: [] };
  const e = (program: string, createdById: string | null, leadAssignedToId: string | null = null) => ({ program, createdById, leadAssignedToId });
  it("lets Finance record anything", () => {
    expect(canTrackEnrollment(fin, e("GCAN", "someone"))).toBe(true);
  });
  it("lets the coordinator record every enrollment in their programs, whoever added it", () => {
    expect(canTrackEnrollment(coord, e("OSCE", "u_fe"))).toBe(true);
    expect(canTrackEnrollment(coord, e("NCLEX", null))).toBe(true);
    expect(canTrackEnrollment(coord, e("GCAN", "u_coord"))).toBe(false);
  });
  it("lets a BDE record the GCAN enrollments they added or whose lead is theirs", () => {
    expect(canTrackEnrollment(bde, e("GCAN", "u_bde"))).toBe(true);
    expect(canTrackEnrollment(bde, e("GCAN", "u_fe", "u_bde"))).toBe(true);
    expect(canTrackEnrollment(bde, e("GCAN", "other_bde", "other_bde"))).toBe(false);
    expect(canTrackEnrollment(bde, e("OSCE", "u_bde"))).toBe(false);
  });
});
