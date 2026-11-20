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
  commissionTerms,
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
  ordinal,
  installmentCap,
  parsePlans,
  planLabel,
  suggestedInstallment,
  openAud,
  runDue,
  splitByProgram,
  statusAfterApproval,
  statusAfterReturn,
  suggestInvoiceNumber,
  bumpInvoiceNumber,
  invoiceStem,
  assignVolume,
  checkVolumeTiers,
  isVolumeFy,
  parseVolumeOpening,
  parseVolumeTiers,
  volumeExtraPct,
  volumeFyMonths,
  volumeFyOf,
  volumeFyOfDate,
  volumeLineLabel,
  volumeTiersLabel,
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
    // A flat program (GCAN): the same amount whatever the course fee, the % is ignored.
    expect(commissionOf(7500, 10, 800)).toBe(800);
    expect(commissionOf(9200, 0, 800)).toBe(800);
    expect(commissionOf(2400, 20, null)).toBe(480);
    expect(commissionTerms(20, null)).toBe("20%");
    expect(commissionTerms(10, 800)).toBe("Flat AUD 800");
    expect(balanceOf(fee, [{ amount: 1000 }, { amount: 500 }])).toBe(800);
    expect(balanceOf(fee, [{ amount: 2300 }])).toBe(0);
  });
  it("refuses an installment over the balance, a 7th installment, or a future date", () => {
    const today = "2026-10-20";
    expect(checkInstallment({ courseFee: fee, payments: [{ amount: 2000 }], amount: 301, paidOn: today, today })).toMatch(/more than the balance/);
    const five = Array.from({ length: 5 }, () => ({ amount: 100 }));
    expect(checkInstallment({ courseFee: fee, payments: five, amount: 100, paidOn: today, today })).toBeNull(); // 6th is fine
    expect(checkInstallment({ courseFee: fee, payments: [...five, { amount: 100 }], amount: 100, paidOn: today, today })).toMatch(/All 6/);
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

describe("installment plans (GCAN: 1, 2 or 6)", () => {
  it("caps installments at the plan, else at 6", () => {
    expect(installmentCap(2)).toBe(2);
    expect(installmentCap(1)).toBe(1);
    expect(installmentCap(null)).toBe(6);
    const today = "2026-10-26";
    expect(checkInstallment({ courseFee: 8000, payments: [{ amount: 4000 }, { amount: 3000 }], amount: 1000, paidOn: today, today, plan: 2 })).toMatch(/All 2 installments on this plan/);
    expect(checkInstallment({ courseFee: 8000, payments: [{ amount: 4000 }], amount: 4000, paidOn: today, today, plan: 2 })).toBeNull();
  });
  it("suggests an even split, with the last installment taking what's left", () => {
    expect(suggestedInstallment(8000, 6, 0)).toBe(1333.33);
    expect(suggestedInstallment(8000, 2, 0)).toBe(4000);
    expect(suggestedInstallment(8000, 1, 0)).toBe(8000);
    expect(suggestedInstallment(1333.35, 6, 5)).toBe(1333.35);
    expect(suggestedInstallment(5000, null, 1)).toBe(5000);
  });
  it("reads plan options typed in Settings", () => {
    expect(parsePlans("1, 2, 6")).toEqual([1, 2, 6]);
    expect(parsePlans("6 2 1 2")).toEqual([1, 2, 6]);
    expect(parsePlans("")).toEqual([]);
    expect(parsePlans("7")).toBeNull();
    expect(parsePlans("two")).toBeNull();
    expect(planLabel(1)).toBe("1 installment (full fee)");
    expect(planLabel(6)).toBe("6 installments");
  });
});

describe("installment labels", () => {
  it("counts up to the 6th and beyond", () => {
    expect([1, 2, 3, 4, 5, 6].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "5th", "6th"]);
    expect([11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(["11th", "12th", "13th", "21st", "22nd", "23rd"]);
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
  it("recognises the series shape, with the year either way", () => {
    expect(looksLikeSeries("D/DLLC/", "D/DLLC/26-27/012")).toBe(true);
    expect(looksLikeSeries("D/DLLC/", "D/DLLC/2627/030")).toBe(true);
    expect(looksLikeSeries("D/DLLC/", "INV-12")).toBe(false);
  });
  it("writes the number the way the shared (Wio) series does, counting both year styles", () => {
    const compact = { fyStyle: "compact" as const, padding: 3 };
    expect(invoiceStem("D/DLLC/", "2026-11-20", compact)).toBe("D/DLLC/2627/");
    expect(invoiceStem("D/DLLC/", "2026-11-20")).toBe("D/DLLC/26-27/");
    // 012 and 019 were written 26-27; 030 was renamed to Wio's 2627 style → next is 031 in Wio's style.
    const existing = ["D/DLLC/26-27/012", "D/DLLC/26-27/019", "D/DLLC/2627/030"];
    expect(suggestInvoiceNumber("D/DLLC/", "2026-11-20", existing, "D/DLLC/26-27/025", compact)).toBe("D/DLLC/2627/031");
    // Without the style the old dash format is kept, but 030 still counts — never 025 again.
    expect(suggestInvoiceNumber("D/DLLC/", "2026-11-20", existing, "D/DLLC/26-27/025")).toBe("D/DLLC/26-27/031");
    // A floor written in the other style still applies; padding follows the series.
    expect(suggestInvoiceNumber("D/DLLC/", "2026-11-20", [], "d/dllc/26-27/040", { fyStyle: "compact", padding: 4 })).toBe("D/DLLC/2627/0040");
  });
  it("steps a number on, keeping its series and digits", () => {
    expect(bumpInvoiceNumber("D/DLLC/2627/030")).toBe("D/DLLC/2627/031");
    expect(bumpInvoiceNumber("D/DLLC/26-27/099")).toBe("D/DLLC/26-27/100");
    expect(bumpInvoiceNumber("custom")).toBe("custom");
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
  it("prints a flat commission line", async () => {
    const flatLine = { ...base.lines[0], description: "GCAN candidate", courseName: "GCAN Online", courseFee: 7500, commissionPct: 0, commissionFlat: 800, amount: 800 };
    const doc = await PDFDocument.load(await buildInvoicePdf({ ...base, layout: "detailed", lines: [flatLine], total: 800, words: "AUD Eight Hundred" }));
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

describe("volume bonus (per Australian financial year)", () => {
  const NAI = [
    { from: 51, extraPct: 5 },
    { from: 101, extraPct: 10 },
  ];
  const items = (n: number, intakeMonth = "Mar-26", flat = false) =>
    Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, intakeMonth, flat }));

  it("puts an intake month in its July–June year", () => {
    expect(volumeFyOf("Jul-25")).toBe("2025-26");
    expect(volumeFyOf("Nov-25")).toBe("2025-26");
    expect(volumeFyOf("Jun-26")).toBe("2025-26");
    expect(volumeFyOf("Jul-26")).toBe("2026-27");
    expect(volumeFyOf("Jan-27")).toBe("2026-27");
    expect(volumeFyOf("March 2026")).toBeNull();
    expect(volumeFyOfDate("2026-11-20")).toBe("2026-27");
    expect(volumeFyOfDate("2026-06-30")).toBe("2025-26");
  });

  it("lists a year's twelve intake months, each mapping back to it", () => {
    const months = volumeFyMonths("2025-26");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("Jul-25");
    expect(months[11]).toBe("Jun-26");
    expect(months.every((m) => volumeFyOf(m) === "2025-26")).toBe(true);
    expect(volumeFyMonths("2099-00")[11]).toBe("Jun-00");
  });

  it("recognises a financial-year key", () => {
    expect(isVolumeFy("2025-26")).toBe(true);
    expect(isVolumeFy("2099-00")).toBe(true);
    expect(isVolumeFy("2025-27")).toBe(false);
    expect(isVolumeFy("25-26")).toBe(false);
  });

  it("applies the highest tier reached, not the sum", () => {
    expect(volumeExtraPct(NAI, 1)).toBe(0);
    expect(volumeExtraPct(NAI, 50)).toBe(0);
    expect(volumeExtraPct(NAI, 51)).toBe(5);
    expect(volumeExtraPct(NAI, 100)).toBe(5);
    expect(volumeExtraPct(NAI, 101)).toBe(10);
    expect(volumeExtraPct(NAI, 900)).toBe(10);
    expect(volumeExtraPct([...NAI].reverse(), 101)).toBe(10);
    expect(volumeExtraPct([], 500)).toBe(0);
  });

  it("validates tiers", () => {
    expect(checkVolumeTiers(NAI)).toBeNull();
    expect(checkVolumeTiers([])).toBeNull();
    expect(checkVolumeTiers([{ from: 1, extraPct: 5 }])).toMatch(/from 2/);
    expect(checkVolumeTiers([{ from: 51, extraPct: 0 }])).toMatch(/more than 0/);
    expect(checkVolumeTiers([{ from: 51, extraPct: 5 }, { from: 51, extraPct: 10 }])).toMatch(/same enrollment/);
    expect(checkVolumeTiers(Array.from({ length: 6 }, (_, i) => ({ from: 10 * (i + 2), extraPct: 1 })))).toMatch(/Up to 5/);
  });

  it("reads stored JSON defensively", () => {
    expect(parseVolumeTiers([{ from: 101, extraPct: 10 }, { from: 51, extraPct: 5 }, { from: "x" }, null, 3])).toEqual(NAI);
    expect(parseVolumeTiers({})).toEqual([]);
    expect(parseVolumeOpening({ "2025-26": 71, "2026-27": 0, bad: 4, "2024-25": 1.5 })).toEqual({ "2025-26": 71 });
    expect(parseVolumeOpening([])).toEqual({});
  });

  it("numbers the 8 late FY 2025-26 enrollments #72–79 at +5% after 71 billed outside DesGro", () => {
    const v = assignVolume({ tiers: NAI, opening: { "2025-26": 71 }, billed: {}, items: items(8) });
    expect([...v.values()].map((x) => x.seq)).toEqual([72, 73, 74, 75, 76, 77, 78, 79]);
    expect([...v.values()].every((x) => x.extraPct === 5 && x.fy === "2025-26")).toBe(true);
  });

  it("starts the bonus exactly at the 51st and steps up at the 101st", () => {
    const a = assignVolume({ tiers: NAI, opening: { "2026-27": 40 }, billed: { "2026-27": 9 }, items: items(3, "Aug-26") });
    expect([...a.values()].map((x) => [x.seq, x.extraPct])).toEqual([[50, 0], [51, 5], [52, 5]]);
    const b = assignVolume({ tiers: NAI, opening: {}, billed: { "2026-27": 99 }, items: items(3, "Aug-26") });
    expect([...b.values()].map((x) => [x.seq, x.extraPct])).toEqual([[100, 5], [101, 10], [102, 10]]);
  });

  it("counts each financial year separately within one invoice", () => {
    const v = assignVolume({
      tiers: NAI,
      opening: { "2025-26": 71 },
      billed: { "2026-27": 3 },
      items: [
        { id: "old", intakeMonth: "Apr-26", flat: false },
        { id: "new", intakeMonth: "Sep-26", flat: false },
        { id: "old2", intakeMonth: "Jun-26", flat: false },
      ],
    });
    expect(v.get("old")).toEqual({ fy: "2025-26", seq: 72, extraPct: 5 });
    expect(v.get("new")).toEqual({ fy: "2026-27", seq: 4, extraPct: 0 });
    expect(v.get("old2")).toEqual({ fy: "2025-26", seq: 73, extraPct: 5 });
  });

  it("counts a flat-commission enrollment but gives it no % bonus; skips an unreadable intake", () => {
    const v = assignVolume({
      tiers: NAI,
      opening: { "2026-27": 50 },
      billed: {},
      items: [
        { id: "flat", intakeMonth: "Oct-26", flat: true },
        { id: "bad", intakeMonth: "??", flat: false },
        { id: "pct", intakeMonth: "Oct-26", flat: false },
      ],
    });
    expect(v.get("flat")).toEqual({ fy: "2026-27", seq: 51, extraPct: 0 });
    expect(v.has("bad")).toBe(false);
    expect(v.get("pct")).toEqual({ fy: "2026-27", seq: 52, extraPct: 5 });
  });

  it("assigns nothing for a partner without tiers", () => {
    expect(assignVolume({ tiers: [], opening: { "2025-26": 71 }, billed: {}, items: items(3) }).size).toBe(0);
  });

  it("labels tiers and billed lines", () => {
    expect(volumeTiersLabel(NAI)).toBe("+5% from #51 · +10% from #101");
    expect(volumeLineLabel({ volumeSeq: 72, volumeFy: "2025-26", volumeBonusPct: 5 })).toBe("#72 · FY 2025-26 · +5% volume");
    expect(volumeLineLabel({ volumeSeq: 12, volumeFy: "2026-27", volumeBonusPct: null })).toBe("#12 · FY 2026-27");
    expect(volumeLineLabel({ volumeSeq: null, volumeFy: null, volumeBonusPct: null })).toBeNull();
    expect(commissionOf(2500, 20 + volumeExtraPct(NAI, 72))).toBe(625);
  });
});
