import { describe, expect, it } from "vitest";
import {
  amountInWords,
  billToLines,
  computeInvoiceAmounts,
  defaultDescription,
  formatInvoiceNo,
  fyCode,
  isGstin,
  isSeriesNumber,
  lockedFieldChanges,
  nextSeq,
  restyleNumber,
  notInvoiceableReason,
  seqInStem,
  seriesKeyFor,
  seriesStem,
  setupGaps,
  splitGst,
  wholeInWords,
  intoStem,
  runningNumber,
  sameInvoiceNumber,
  stemKey,
  stemOfNumber,
  stemVariants,
  numberAfter,
  startsAtOne,
  correctedNumber,
  numberCorrectionOpen,
  projectNumbers,
} from "@/lib/invoices/core";
import { gstStateByName, gstStateOfGstin, placeOfSupplyLabel } from "@/lib/invoices/gst-states";

describe("splitGst", () => {
  it("works GST back out of the amount received, as on the D/DIPL sample", () => {
    expect(splitGst(34220, true)).toEqual({ taxable: 29000, cgst: 2610, sgst: 2610, igst: 0 });
  });

  it("charges IGST for a candidate outside the issuer's state", () => {
    expect(splitGst(34220, false)).toEqual({ taxable: 29000, cgst: 0, sgst: 0, igst: 5220 });
  });

  it("always adds back to the amount received, to the paisa", () => {
    for (const gross of [10001, 9999.99, 1, 123456.78, 50000, 33333.33]) {
      for (const same of [true, false]) {
        const s = splitGst(gross, same);
        expect(Math.round((s.taxable + s.cgst + s.sgst + s.igst) * 100)).toBe(Math.round(gross * 100));
      }
    }
  });

  it("splits an odd paisa between CGST and SGST without losing it", () => {
    const s = splitGst(10001, true); // GST 1525.58
    expect(s.cgst + s.sgst).toBeCloseTo(1525.58, 2);
    expect(Math.abs(s.cgst - s.sgst)).toBeLessThanOrEqual(0.01);
  });
});

describe("computeInvoiceAmounts", () => {
  it("DIPL domestic: INR with GST inside the total", () => {
    expect(computeInvoiceAmounts({ entity: "DIPL", kind: "DOM", receivedInr: 34220, sameState: true, foreign: null })).toEqual({
      currency: "INR",
      taxable: 29000,
      cgst: 2610,
      sgst: 2610,
      igst: 0,
      total: 34220,
      receivedInr: 34220,
      exchangeRate: 1,
    });
  });

  it("DIPL export in the candidate's currency, as on the E/DIPL sample (CAD 624.08 = ₹41,300)", () => {
    const a = computeInvoiceAmounts({ entity: "DIPL", kind: "EXP", receivedInr: 41300, sameState: false, foreign: { currency: "cad", amount: 624.08 } });
    expect(a).toMatchObject({ currency: "CAD", total: 624.08, taxable: 624.08, cgst: 0, sgst: 0, igst: 0, receivedInr: 41300 });
    expect("exchangeRate" in a && a.exchangeRate).toBeCloseTo(66.177, 3);
  });

  it("DIPL export without a foreign amount stays in rupees, with no GST", () => {
    expect(computeInvoiceAmounts({ entity: "DIPL", kind: "EXP", receivedInr: 41300, sameState: true, foreign: null })).toMatchObject({
      currency: "INR",
      total: 41300,
      cgst: 0,
      igst: 0,
    });
  });

  it("DLLC needs the AED amount and is always domestic, untaxed", () => {
    expect(computeInvoiceAmounts({ entity: "DLLC", kind: "EXP", receivedInr: 31500, sameState: false, foreign: null })).toEqual({
      problem: "foreign_amount_required",
    });
    expect(computeInvoiceAmounts({ entity: "DLLC", kind: "EXP", receivedInr: 31500, sameState: false, foreign: { currency: "AED", amount: 1400 } })).toMatchObject({
      currency: "AED",
      total: 1400,
      cgst: 0,
      igst: 0,
    });
  });

  it("refuses a foreign currency on a domestic DIPL invoice, INR as 'foreign', and zero amounts", () => {
    expect(computeInvoiceAmounts({ entity: "DIPL", kind: "DOM", receivedInr: 100, sameState: true, foreign: { currency: "AED", amount: 5 } })).toEqual({
      problem: "foreign_not_allowed",
    });
    expect(computeInvoiceAmounts({ entity: "DIPL", kind: "EXP", receivedInr: 100, sameState: true, foreign: { currency: "INR", amount: 100 } })).toEqual({
      problem: "foreign_currency_invalid",
    });
    expect(computeInvoiceAmounts({ entity: "DIPL", kind: "DOM", receivedInr: 0, sameState: true, foreign: null })).toEqual({ problem: "amount_not_positive" });
    expect(computeInvoiceAmounts({ entity: "DLLC", kind: "DOM", receivedInr: 100, sameState: true, foreign: { currency: "AED", amount: 0 } })).toEqual({
      problem: "foreign_amount_required",
    });
  });
});

describe("numbering", () => {
  it("writes the financial year either way", () => {
    expect(fyCode("2026-10-01")).toBe("26-27");
    expect(fyCode("2027-03-31")).toBe("26-27");
    expect(fyCode("2027-04-01")).toBe("27-28");
    expect(fyCode("2026-10-01", "compact")).toBe("2627");
  });

  it("builds numbers like the samples", () => {
    expect(formatInvoiceNo(seriesStem("D/DIPL/", "2026-10-01", "dash"), 525, 4)).toBe("D/DIPL/26-27/0525");
    expect(formatInvoiceNo(seriesStem("E/DIPL/", "2026-10-26", "dash"), 68, 3)).toBe("E/DIPL/26-27/068");
    expect(formatInvoiceNo(seriesStem("D/DLLC/", "2026-10-16", "dash"), 23, 3)).toBe("D/DLLC/26-27/023");
    expect(formatInvoiceNo(seriesStem("D/DIPL/", "2026-10-01", "compact"), 525, 4)).toBe("D/DIPL/2627/0525");
  });

  it("continues one above the highest number used, and never below the floor", () => {
    const stem = "D/DIPL/26-27/";
    expect(nextSeq(stem, [], [])).toBe(1);
    expect(nextSeq(stem, ["D/DIPL/26-27/0007", "D/DIPL/26-27/0003"], [])).toBe(8);
    expect(nextSeq(stem, ["D/DIPL/26-27/0007"], ["D/DIPL/26-27/0526"])).toBe(526);
    expect(nextSeq(stem, ["D/DIPL/26-27/0600"], ["D/DIPL/26-27/0526"])).toBe(601);
  });

  it("ignores other series, other years, and a floor written for another year", () => {
    const stem = "D/DIPL/27-28/";
    expect(nextSeq(stem, ["D/DIPL/26-27/0900", "E/DIPL/27-28/050", "D/DIPL/27-28/abc"], ["D/DIPL/26-27/0526"])).toBe(1);
    expect(seqInStem("D/DLLC/26-27/", "D/DLLC/26-27/025")).toBe(25);
    expect(seqInStem("D/DLLC/26-27/", "D/DLLC/26-27/025A")).toBeNull();
  });

  it("maps company and kind to a series", () => {
    expect(seriesKeyFor("DIPL", "DOM")).toBe("DIPL-DOM");
    expect(seriesKeyFor("DIPL", "EXP")).toBe("DIPL-EXP");
    expect(seriesKeyFor("DLLC", "EXP")).toBe("DLLC-DOM");
  });
});

describe("one series, either year style", () => {
  it("treats 26-27 and 2627 as the same series", () => {
    expect(stemKey("D/DLLC/26-27/")).toBe(stemKey("d/dllc/2627/"));
    expect(stemKey("D/DLLC/26-27/")).not.toBe(stemKey("D/DIPL/26-27/"));
    expect(stemVariants("D/DLLC/26-27/")).toEqual(["D/DLLC/26-27/", "D/DLLC/2627/"]);
    expect(stemVariants("D/DLLC/2627/")).toEqual(["D/DLLC/2627/", "D/DLLC/26-27/"]);
    expect(stemVariants("INV/")).toEqual(["INV/"]);
  });
  it("reads a number's stem and running number", () => {
    expect(stemOfNumber("D/DLLC/2627/030")).toBe("D/DLLC/2627/");
    expect(runningNumber("D/DLLC/2627/030")).toBe(30);
    expect(runningNumber("D/DLLC/2627/03A")).toBeNull();
  });
  it("matches one number however it's written", () => {
    expect(sameInvoiceNumber("D/DLLC/26-27/030", "D/DLLC/2627/030")).toBe(true);
    expect(sameInvoiceNumber("D/DLLC/2627/30", "d/dllc/26-27/030")).toBe(true);
    expect(sameInvoiceNumber("D/DLLC/2627/030", "D/DLLC/2627/031")).toBe(false);
    expect(sameInvoiceNumber("D/DLLC/2627/030", "D/DIPL/2627/030")).toBe(false);
    expect(sameInvoiceNumber("D/DLLC/2627/030", "D/DLLC/2728/030")).toBe(false);
  });
  it("rewrites a series' numbers into one stem and drops the rest", () => {
    expect(intoStem("D/DLLC/2627/", ["D/DLLC/26-27/030", "D/DLLC/2627/029", "D/DLLC/27-28/001", "D/DIPL/26-27/500", null, "junk"])).toEqual([
      "D/DLLC/2627/030",
      "D/DLLC/2627/029",
    ]);
  });
});

describe("amountInWords", () => {
  it("matches the three samples", () => {
    expect(amountInWords(34220, "INR")).toBe("INR Thirty Four Thousand Two Hundred Twenty");
    expect(amountInWords(1400, "AED")).toBe("AED One Thousand Four Hundred");
    expect(amountInWords(624.08, "CAD")).toBe("Six Hundred Twenty Four Canadian Dollars and Eight Cents");
  });

  it("uses lakh and crore for rupees, and paise", () => {
    expect(wholeInWords(150000, true)).toBe("One Lakh Fifty Thousand");
    expect(wholeInWords(150000, false)).toBe("One Hundred Fifty Thousand");
    expect(wholeInWords(123456789, true)).toBe("Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine");
    expect(amountInWords(1000.5, "INR")).toBe("INR One Thousand and Fifty Paise");
    expect(amountInWords(0, "INR")).toBe("INR Zero");
  });

  it("falls back to the code for a currency it has no words for", () => {
    expect(amountInWords(12, "JPY")).toBe("JPY Twelve");
  });
});

describe("lockedFieldChanges", () => {
  const current = { type: "Revenue", date: new Date("2026-12-02T00:00:00Z"), amount: "34220.00", paymentMode: "Axis Bank", partyId: "p1", expDom: "DOM" };

  it("allows edits that don't touch what the invoice printed", () => {
    expect(lockedFieldChanges(current, { amount: 34220, date: "2026-12-02", paymentMode: "Axis Bank" })).toEqual([]);
    expect(lockedFieldChanges(current, {})).toEqual([]);
  });

  it("names the printed fields an edit would change", () => {
    expect(lockedFieldChanges(current, { amount: 34000, date: "2026-12-03", partyId: "p2", expDom: "EXP" })).toEqual([
      "date",
      "amount",
      "partyId",
      "expDom",
    ]);
  });
});

describe("notInvoiceableReason", () => {
  const ok = {
    type: "Revenue",
    deletedAt: null,
    isHistorical: false,
    category: "Sales - Nursing Registrations",
    paymentMode: "Axis Bank",
    date: "2026-12-05",
    partyGroup: "Candidate",
  };
  const opts = { activeBanks: ["Axis Bank", "HDFC Bank", "Wio Bank"], startsOn: "2026-12-01" };

  it("accepts a candidate payment into an invoicing bank after the cut-over", () => {
    expect(notInvoiceableReason(ok, opts)).toBeNull();
  });

  it("explains every refusal", () => {
    expect(notInvoiceableReason({ ...ok, type: "Expense" }, opts)).toBe("not_revenue");
    expect(notInvoiceableReason({ ...ok, isHistorical: true }, opts)).toBe("historical");
    expect(notInvoiceableReason({ ...ok, category: "Commissions" }, opts)).toBe("partner_commission");
    expect(notInvoiceableReason({ ...ok, partyGroup: "Vendor" }, opts)).toBe("no_candidate");
    expect(notInvoiceableReason({ ...ok, paymentMode: "Cash" }, opts)).toBe("not_invoice_bank");
    expect(notInvoiceableReason({ ...ok, paymentMode: "Wio Bank" }, { ...opts, activeBanks: ["Axis Bank"] })).toBe("bank_off");
    expect(notInvoiceableReason({ ...ok, date: "2026-11-30" }, opts)).toBe("before_cutover");
    expect(notInvoiceableReason(ok, { ...opts, startsOn: null })).toBe("no_cutover");
  });
});

describe("helpers", () => {
  it("drops the Sales/Collection tag from the default description", () => {
    expect(defaultDescription("AHPRA OBA Pathway (Sales)")).toBe("AHPRA OBA Pathway");
    expect(defaultDescription("ANMAC + PR (Collection)")).toBe("ANMAC + PR");
    expect(defaultDescription(null)).toBe("");
  });

  it("knows GST state codes", () => {
    expect(gstStateOfGstin("32ABCDE1234F1Z5")?.name).toBe("Kerala");
    expect(gstStateByName(" tamil nadu ")?.code).toBe("33");
    expect(gstStateByName("Atlantis")).toBeNull();
    expect(placeOfSupplyLabel(gstStateByName("Kerala")!)).toBe("Kerala (32)");
  });
});

describe("billToLines and settings checks", () => {
  it("ends an Indian address with PIN, state and India, as on the samples", () => {
    expect(billToLines({ address: "House 1, Sample PO,\nSample District", pin: "600001", state: "Kerala", country: "India" })).toEqual([
      "House 1, Sample PO,",
      "Sample District",
      "PIN: 600001, Kerala, India",
    ]);
  });

  it("ends a foreign address with province, country and postcode", () => {
    expect(billToLines({ address: "1 Sample Road", pin: "T0A 0A0", state: "Alberta", country: "Canada" })).toEqual(["1 Sample Road", "Alberta, Canada, T0A 0A0"]);
  });

  it("lists what Invoice settings still lack", () => {
    const entity = { code: "DIPL", legalName: "X Pvt Ltd", headerLines: "Addr", signFor: "For X", signatoryName: "S", gstin: "32ABCDE1234F1Z5", sacCode: "998311", hasSignature: true };
    expect(setupGaps(entity, { paymentMode: "Axis Bank", details: "A/c 1" }, { prefix: "D/DIPL/" })).toEqual([]);
    expect(setupGaps({ ...entity, gstin: "bad", hasSignature: false }, { paymentMode: "Axis Bank", details: " " }, { prefix: "D/DIPL/" })).toEqual([
      "India company: signature image",
      "India company: GSTIN",
      "Axis Bank: bank details to print",
    ]);
    // The UAE company has no GSTIN or SAC to ask for.
    expect(setupGaps({ ...entity, code: "DLLC", gstin: null, sacCode: "" }, { paymentMode: "Wio Bank", details: "IBAN" }, { prefix: "D/DLLC/" })).toEqual([]);
  });

  it("checks GSTINs and next-number settings", () => {
    expect(isGstin("32ABCDE1234F1Z5")).toBe(true);
    expect(isGstin("32ABCDE1234F1X5")).toBe(false);
    expect(isSeriesNumber("D/DIPL/", "dash", "D/DIPL/26-27/0526")).toBe(true);
    expect(isSeriesNumber("D/DIPL/", "compact", "D/DIPL/26-27/0526")).toBe(false);
    expect(isSeriesNumber("D/DIPL/", "compact", "D/DIPL/2627/0526")).toBe(true);
    expect(isSeriesNumber("D/DLLC/", "dash", "D/DIPL/26-27/0526")).toBe(false);
  });
});

describe("restyleNumber", () => {
  it("carries a next-number floor across a format change", () => {
    const dash = { prefix: "D/DIPL/", fyStyle: "dash" as const };
    expect(restyleNumber("D/DIPL/26-27/0526", dash, { prefix: "D/DIPL/", fyStyle: "compact", padding: 4 })).toBe("D/DIPL/2627/0526");
    expect(restyleNumber("D/DIPL/2627/0526", { prefix: "D/DIPL/", fyStyle: "compact" }, { prefix: "D/DIPL/", fyStyle: "dash", padding: 4 })).toBe("D/DIPL/26-27/0526");
    expect(restyleNumber("D/DIPL/26-27/0526", dash, { prefix: "DI/", fyStyle: "dash", padding: 3 })).toBe("DI/26-27/526");
    expect(restyleNumber("E/DIPL/26-27/0526", dash, { prefix: "D/DIPL/", fyStyle: "compact", padding: 4 })).toBeNull();
  });
});

describe("next numbers shown before issuing", () => {
  it("counts on from the next number, keeping the series' digits", () => {
    expect(numberAfter("D/DIPL/2627/0671", 0, 4)).toBe("D/DIPL/2627/0671");
    expect(numberAfter("D/DIPL/2627/0671", 2, 4)).toBe("D/DIPL/2627/0673");
    expect(numberAfter("E/DIPL/2627/077", 1, 3)).toBe("E/DIPL/2627/078");
    expect(numberAfter("E/DIPL/2627/999", 1, 3)).toBe("E/DIPL/2627/1000");
  });

  it("flags a series that starts at 1 only when no next number was set for that year", () => {
    expect(startsAtOne("D/DIPL/2627/0001", null)).toBe(true);
    expect(startsAtOne("D/DIPL/2627/0001", "D/DIPL/2526/0900")).toBe(true); // last year's floor doesn't count
    expect(startsAtOne("D/DIPL/2627/0001", "D/DIPL/2627/0001")).toBe(false); // set on purpose
    expect(startsAtOne("D/DIPL/2627/0670", "D/DIPL/2627/0670")).toBe(false);
    expect(startsAtOne("D/DIPL/2627/0002", null)).toBe(false);
  });

  it("projects each waiting payment's number in list order, per series and year", () => {
    const upcoming = {
      "26-27": { "DIPL-DOM": "D/DIPL/2627/0671", "DIPL-EXP": "E/DIPL/2627/077", "DLLC-DOM": "D/DLLC/2627/031" },
      "25-26": { "DIPL-DOM": "D/DIPL/2526/0950", "DIPL-EXP": "E/DIPL/2526/120", "DLLC-DOM": "D/DLLC/2526/090" },
    };
    const pad = { "DIPL-DOM": 4, "DIPL-EXP": 3, "DLLC-DOM": 3 };
    const rows = [
      { id: "a", date: "2027-03-30", entityCode: "DIPL", expDom: "DOM", blocked: false },
      { id: "b", date: "2026-11-20", entityCode: "DIPL", expDom: "DOM", blocked: false },
      { id: "c", date: "2026-11-21", entityCode: "DIPL", expDom: null, blocked: false },
      { id: "d", date: "2026-11-21", entityCode: "DIPL", expDom: "EXP", blocked: false },
      { id: "e", date: "2026-11-22", entityCode: "DIPL", expDom: "DOM", blocked: true },
      { id: "f", date: "2026-11-22", entityCode: "DLLC", expDom: "EXP", blocked: false },
      { id: "g", date: "2026-11-23", entityCode: "DIPL", expDom: "DOM", blocked: false },
    ];
    const got = projectNumbers(rows, upcoming, pad);
    expect(got).toEqual({
      a: "D/DIPL/2627/0671", // 30 Mar 2027 is still FY 26-27
      b: "D/DIPL/2627/0672",
      c: "D/DIPL/2627/0673", // no EXP/DOM yet: the form defaults to domestic
      d: "E/DIPL/2627/077",
      f: "D/DLLC/2627/031", // Wio is always the UAE series
      g: "D/DIPL/2627/0674", // e is waiting for an approval, so it takes no number
    });
    expect(projectNumbers([{ id: "x", date: "2026-03-31", entityCode: "DIPL", expDom: "DOM", blocked: false }], upcoming, pad)).toEqual({ x: "D/DIPL/2526/0950" });
  });
});

describe("correcting an issued invoice's number", () => {
  const dom = { prefix: "D/DIPL/", fyStyle: "compact" as const, padding: 4 };

  it("takes the whole number or just the running number, written as the series writes it", () => {
    expect(correctedNumber("D/DIPL/2627/0670", dom, "2026-11-20")).toEqual({ number: "D/DIPL/2627/0670", seq: 670 });
    expect(correctedNumber("d/dipl/2627/670", dom, "2026-11-20")).toEqual({ number: "D/DIPL/2627/0670", seq: 670 });
    expect(correctedNumber(" 670 ", dom, "2026-11-20")).toEqual({ number: "D/DIPL/2627/0670", seq: 670 });
    expect(correctedNumber("77", { prefix: "E/DIPL/", fyStyle: "compact", padding: 3 }, "2026-11-20")).toEqual({ number: "E/DIPL/2627/077", seq: 77 });
  });

  it("refuses another series, another year, a different year style, or zero", () => {
    expect(correctedNumber("E/DIPL/2627/0670", dom, "2026-11-20")).toEqual({ problem: "format" });
    expect(correctedNumber("D/DIPL/26-27/0670", dom, "2026-11-20")).toEqual({ problem: "format" });
    expect(correctedNumber("D/DIPL/2526/0670", dom, "2026-11-20")).toEqual({ problem: "year" });
    expect(correctedNumber("0", dom, "2026-11-20")).toEqual({ problem: "zero" });
    expect(correctedNumber("D/DIPL/2627/0000", dom, "2026-11-20")).toEqual({ problem: "zero" });
    expect(correctedNumber("", dom, "2026-11-20")).toEqual({ problem: "format" });
    expect(correctedNumber("1234567", dom, "2026-11-20")).toEqual({ problem: "format" });
  });

  it("is open until the 10th of the month after the invoice date (before GSTR-1 falls due)", () => {
    expect(numberCorrectionOpen("2026-11-20", "2026-11-23")).toBe(true);
    expect(numberCorrectionOpen("2026-11-20", "2026-12-10")).toBe(true);
    expect(numberCorrectionOpen("2026-11-20", "2026-12-11")).toBe(false);
    expect(numberCorrectionOpen("2026-12-31", "2027-01-05")).toBe(true);
    expect(numberCorrectionOpen("2026-10-31", "2026-12-01")).toBe(false);
  });
});

