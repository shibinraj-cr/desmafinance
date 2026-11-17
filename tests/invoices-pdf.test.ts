import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildCandidateInvoicePdf, inr, plain, stampWatermark, totalText, type InvoicePdfInput } from "@/lib/invoices/pdf";
import { amountInWords, splitGst } from "@/lib/invoices/core";

const font = new Uint8Array(readFileSync(join(__dirname, "..", "public", "fonts", "esign", "NotoSans-Regular.ttf")));

function input(over: Partial<InvoicePdfInput> = {}): InvoicePdfInput {
  const s = splitGst(34220, true);
  return {
    layout: "dipl-dom",
    title: "Domestic Invoice",
    number: "D/DIPL/26-27/0001",
    invoiceDate: "2026-12-01",
    paymentTerm: "Immediate",
    currency: "INR",
    issuer: { legalName: "Example Pvt Ltd", headerLines: "1 Sample Road\nSample Town", signFor: "For Example Pvt Ltd", thanksLine: "Thank you!", signatoryName: "Signatory" },
    billTo: { name: "Test Candidate", lines: ["House 1", "PIN: 600001, Kerala, India"] },
    description: "AHPRA 2nd Instalment of Initial Payment",
    intakeMonth: null,
    hsn: "998311",
    amount: s.taxable,
    tax: { ...s, ratePct: 18 },
    total: 34220,
    receivedInr: 34220,
    words: amountInWords(34220, "INR"),
    note: "Note: fees extra.",
    bankLines: ["Example Pvt Ltd", "Account No : 0000"],
    lutLine: null,
    placeOfSupply: "Kerala (32)",
    signature: null,
    logoPng: null,
    unicodeFont: font,
    ...over,
  };
}

describe("candidate invoice PDF", () => {
  it("renders each layout as a one-page PDF without embedding the 600 KB font for Latin text", async () => {
    for (const layout of ["dipl-dom", "dipl-exp", "dllc"] as const) {
      const bytes = await buildCandidateInvoicePdf(input({ layout, tax: layout === "dipl-dom" ? input().tax : null }));
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getTitle()).toBe("Invoice D/DIPL/26-27/0001");
      // The ₹ sign is a vector shape, so the file stays small.
      expect(bytes.byteLength).toBeLessThan(60_000);
    }
  });

  it("embeds Noto Sans only when a name needs it", async () => {
    const bytes = await buildCandidateInvoicePdf(input({ billTo: { name: "ശ്രീ Test", lines: ["House 1"] } }));
    expect(bytes.byteLength).toBeGreaterThan(200_000);
  });

  it("still renders without the font, writing Rs. for the rupee", async () => {
    const bytes = await buildCandidateInvoicePdf(input({ unicodeFont: null }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("stamps a copy and leaves the original untouched", async () => {
    const original = await buildCandidateInvoicePdf(input());
    const before = Buffer.from(original).toString("base64");
    const stamped = await stampWatermark(original, "CANCELLED", "CANCELLED on 02/12/2026: wrong address");
    expect(Buffer.from(original).toString("base64")).toBe(before);
    expect(stamped.byteLength).toBeGreaterThan(original.byteLength);
    expect((await PDFDocument.load(stamped)).getPageCount()).toBe(1);
  });

  it("formats totals like the samples", () => {
    expect(inr(29000)).toBe("29,000");
    expect(inr(2610, true)).toBe("2,610.00");
    expect(inr(150000)).toBe("1,50,000");
    expect(plain(1400)).toBe("1400");
    expect(totalText({ layout: "dipl-dom", currency: "INR", total: 34220, receivedInr: 34220 })).toBe("34,220");
    expect(totalText({ layout: "dllc", currency: "AED", total: 1400, receivedInr: 31500 })).toBe("AED1,400.00");
    expect(totalText({ layout: "dipl-exp", currency: "CAD", total: 624.08, receivedInr: 41300 })).toBe("624.08(41300)");
  });
});
