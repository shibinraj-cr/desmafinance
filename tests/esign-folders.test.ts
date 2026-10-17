import { describe, expect, it } from "vitest";
import {
  AGREEMENT_DOCS_BLOB_PREFIX,
  agreementDocName,
  agreementDocTypeOf,
  agreementUploadPath,
  isAgreementUploadPath,
  sameDocumentKey,
  sniffAgreementDocType,
} from "@/lib/esign/folders";

const bytes = (...b: number[]) => new Uint8Array(b);
const PDF_HEAD = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37); // %PDF-1.7
const PNG_HEAD = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPG_HEAD = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46);
const HTML_HEAD = new TextEncoder().encode("<html><b");

describe("sniffAgreementDocType", () => {
  it("recognises PDF, PNG and JPEG signatures", () => {
    expect(sniffAgreementDocType(PDF_HEAD)).toBe("application/pdf");
    expect(sniffAgreementDocType(PNG_HEAD)).toBe("image/png");
    expect(sniffAgreementDocType(JPG_HEAD)).toBe("image/jpeg");
  });

  it("refuses anything else, including a short read", () => {
    expect(sniffAgreementDocType(HTML_HEAD)).toBeNull();
    expect(sniffAgreementDocType(bytes(0x25, 0x50))).toBeNull();
    expect(sniffAgreementDocType(bytes())).toBeNull();
  });
});

describe("agreementDocTypeOf", () => {
  it("trusts an accepted browser type first", () => {
    expect(agreementDocTypeOf({ name: "scan", type: "image/png" })).toBe("image/png");
  });

  it("falls back to the extension, case-blind", () => {
    expect(agreementDocTypeOf({ name: "Agreement.PDF", type: "" })).toBe("application/pdf");
    expect(agreementDocTypeOf({ name: "page1.jpeg", type: "" })).toBe("image/jpeg");
  });

  it("sniffs an extensionless file (Odoo exports a few)", () => {
    const file = { name: "NCLEX RN Booking Agreement - DESMA INTERNATIONAL PVT LTD", type: "" };
    expect(agreementDocTypeOf(file)).toBeNull();
    expect(agreementDocTypeOf(file, PDF_HEAD)).toBe("application/pdf");
  });

  it("refuses other types even when the bytes are unknown", () => {
    expect(agreementDocTypeOf({ name: "page.html", type: "text/html" }, HTML_HEAD)).toBeNull();
    expect(agreementDocTypeOf({ name: "notes.docx", type: "application/vnd.openxmlformats" })).toBeNull();
  });
});

describe("agreementDocName", () => {
  it("keeps a name that has an extension", () => {
    expect(agreementDocName("AHPRA Agreement[1] (1).pdf", "application/pdf")).toBe("AHPRA Agreement[1] (1).pdf");
  });

  it("adds the type's extension when there is none", () => {
    expect(agreementDocName("Digital - AHPRA PATHWAY Agreement - DESMA", "application/pdf")).toBe(
      "Digital - AHPRA PATHWAY Agreement - DESMA.pdf",
    );
    expect(agreementDocName("scan", "image/jpeg")).toBe("scan.jpg");
  });

  it("returns null for an unusable name", () => {
    expect(agreementDocName("   ", "application/pdf")).toBeNull();
  });
});

describe("agreementUploadPath", () => {
  // Real shapes from the Odoo Sign export: brackets, doubled spaces, a leading
  // or trailing space before the extension, "(AutoRecovered)", no extension.
  const names = [
    "AHPRA_Agreement DESMA INTERNATIONAL LLC(2).pdf",
    "Aswani SS AHPRA PATHWAY Agreement - DESMA INTERNATIONAL PVT LTD (2)[1][1].pdf",
    "Digital - AHPRA PATHWAY Agreement - DESMA INTERNATIONAL PVT LTD",
    "Merin Susan Moncy _AHPRA_Agreement_-_DESMA_INTERNATIONAL_PVT_LTD.pdf",
    "Roshni Susan Varghese_AHPRA_Agreement_-_DESMA_INTERNATIONAL_PVT_LTD[1] .pdf",
    "Archana_AHPRA_Agreement_-_DESMA_INTERNATIONAL_PVT_LTD[1] (AutoRecovered).pdf",
    "Minu P james PR AGREEMENT .pdf",
    "_leading underscore.pdf",
    "..dots...pdf",
    "....pdf",
    "അനുമതി.pdf",
    "x".repeat(300) + ".pdf",
  ];

  it.each(names)("always yields a path the token route accepts: %s", (name) => {
    const path = agreementUploadPath(name, "application/pdf");
    expect(isAgreementUploadPath(path)).toBe(true);
    expect(path.endsWith(".pdf")).toBe(true);
  });

  it("uses the type's extension, not the file's", () => {
    expect(agreementUploadPath("photo.JPEG", "image/jpeg")).toBe(`${AGREEMENT_DOCS_BLOB_PREFIX}photo.jpg`);
  });

  it("still passes once the store adds its random suffix", () => {
    const path = agreementUploadPath("Agent Agreement.pdf", "application/pdf");
    expect(isAgreementUploadPath(path.replace(/\.pdf$/, "-Ab3xYz09QwErTy.pdf"))).toBe(true);
  });
});

describe("isAgreementUploadPath", () => {
  it("refuses other prefixes, nesting, dot segments and other types", () => {
    expect(isAgreementUploadPath("finance-docs/a.pdf")).toBe(false);
    expect(isAgreementUploadPath(`${AGREEMENT_DOCS_BLOB_PREFIX}sub/a.pdf`)).toBe(false);
    expect(isAgreementUploadPath(`${AGREEMENT_DOCS_BLOB_PREFIX}a..b.pdf`)).toBe(false);
    expect(isAgreementUploadPath(`${AGREEMENT_DOCS_BLOB_PREFIX}page.html`)).toBe(false);
    expect(isAgreementUploadPath(`${AGREEMENT_DOCS_BLOB_PREFIX}_a.pdf`)).toBe(false);
  });
});

describe("sameDocumentKey", () => {
  it("matches the same name and size, case-blind", () => {
    expect(sameDocumentKey("Agent Agreement.pdf", 100)).toBe(sameDocumentKey(" agent agreement.PDF ", 100));
  });

  it("keeps two different files that share a name", () => {
    expect(sameDocumentKey("Agreement.pdf", 4720664)).not.toBe(sameDocumentKey("Agreement.pdf", 4713794));
  });
});
