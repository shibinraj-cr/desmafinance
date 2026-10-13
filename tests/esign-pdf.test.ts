import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { PdfRejectedError, inspectPdf, sha256Hex } from "@/lib/esign/pdf";
import { MAX_TEMPLATE_PAGES } from "@/lib/esign/templates";

async function makePdf(build: (doc: PDFDocument) => void, opts: { objectStreams?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  build(doc);
  return doc.save({ useObjectStreams: opts.objectStreams ?? true });
}

describe("inspectPdf", () => {
  it("measures pages in points", async () => {
    const bytes = await makePdf((d) => {
      d.addPage([595.28, 841.89]);
      d.addPage([612, 792]);
    });
    const info = await inspectPdf(bytes);
    expect(info.numPages).toBe(2);
    expect(info.pages[0]).toEqual({ w: 595.28, h: 841.89, rotate: 0, box: [0, 0, 595.28, 841.89] });
    expect(info.pages[1]).toMatchObject({ w: 612, h: 792 });
  });

  it("reports the displayed size of a rotated page", async () => {
    const bytes = await makePdf((d) => {
      d.addPage([595.28, 841.89]).setRotation(degrees(90));
    });
    const [p] = (await inspectPdf(bytes)).pages;
    expect(p.rotate).toBe(90);
    expect([p.w, p.h]).toEqual([841.89, 595.28]);
    expect(p.box).toEqual([0, 0, 595.28, 841.89]);
  });

  it("measures against the crop box, which is what viewers show", async () => {
    const bytes = await makePdf((d) => {
      d.addPage([600, 800]).setCropBox(50, 100, 500, 600);
    });
    const [p] = (await inspectPdf(bytes)).pages;
    expect(p).toEqual({ w: 500, h: 600, rotate: 0, box: [50, 100, 500, 600] });
  });

  it("refuses a file that is not a PDF", async () => {
    await expect(inspectPdf(new TextEncoder().encode("hello, not a pdf"))).rejects.toThrow(PdfRejectedError);
  });

  it("refuses a damaged PDF", async () => {
    await expect(inspectPdf(new TextEncoder().encode("%PDF-1.7\n garbage"))).rejects.toThrow(/could not be read|no pages/);
  });

  it("refuses an encrypted PDF with advice", async () => {
    // pdf-lib cannot write encryption, so add a Standard security handler by
    // hand: an /Encrypt object plus a trailer reference to it.
    const plain = Buffer.from(await makePdf((d) => void d.addPage(), { objectStreams: false })).toString("latin1");
    const encObj = "99 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (aaaa) /U (bbbb) /P -44 >>\nendobj\n";
    const withEnc = plain.replace(/\nxref\n/, `\n${encObj}xref\n`).replace(/trailer\s*<</, "trailer\n<< /Encrypt 99 0 R");
    expect(withEnc).toContain("/Encrypt 99 0 R");
    await expect(inspectPdf(Buffer.from(withEnc, "latin1"))).rejects.toThrow(/password-protected/);
  });

  it("refuses more pages than a template may have", async () => {
    const bytes = await makePdf((d) => {
      for (let i = 0; i <= MAX_TEMPLATE_PAGES; i++) d.addPage([100, 100]);
    });
    await expect(inspectPdf(bytes)).rejects.toThrow(`at most ${MAX_TEMPLATE_PAGES}`);
  });

  it("hashes bytes as hex SHA-256", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
