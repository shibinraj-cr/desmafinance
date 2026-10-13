import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { MAX_TEMPLATE_PAGES, normalizeRotation, type PageGeometry } from "@/lib/esign/templates";

/**
 * Server-side PDF checks for template uploads.
 *
 * A template is parsed with pdf-lib — the same library that will later burn
 * signatures into it — so a file that cannot be stamped is refused at upload,
 * not discovered when an agreement is being sent.
 */

/** A PDF we will not accept as a template; the message is shown to staff. */
export class PdfRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfRejectedError";
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The PDF header may sit anywhere in the first 1 KB (the spec allows junk before it). */
function hasPdfHeader(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Page count and per-page geometry, or a PdfRejectedError saying why not. */
export async function inspectPdf(bytes: Uint8Array): Promise<{ numPages: number; pages: PageGeometry[] }> {
  if (!hasPdfHeader(bytes)) throw new PdfRejectedError("That file is not a PDF.");
  try {
    return await readPdf(bytes);
  } catch (err) {
    if (err instanceof PdfRejectedError) throw err;
    // pdf-lib parses leniently and can fail late (a missing catalog surfaces
    // as a TypeError on the first page lookup), so any failure here is one.
    throw new PdfRejectedError("This PDF could not be read. It may be damaged; try exporting it again.");
  }
}

async function readPdf(bytes: Uint8Array): Promise<{ numPages: number; pages: PageGeometry[] }> {
  // Loaded with encryption ignored and then checked, rather than catching
  // pdf-lib's EncryptedPDFError: that class is transpiled to ES5, where an
  // Error subclass fails `instanceof`.
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (doc.isEncrypted) {
    throw new PdfRejectedError(
      "This PDF is password-protected or locked against editing, so signatures cannot be added to it. " +
        "Open it and use Print → Save as PDF to make an unlocked copy, then upload that.",
    );
  }

  const numPages = doc.getPageCount();
  if (numPages < 1) throw new PdfRejectedError("This PDF has no pages.");
  if (numPages > MAX_TEMPLATE_PAGES) {
    throw new PdfRejectedError(`This PDF has ${numPages} pages; a template can have at most ${MAX_TEMPLATE_PAGES}.`);
  }

  const pages = doc.getPages().map((page): PageGeometry => {
    // The crop box is what viewers (pdf.js included) display, so field
    // fractions are measured against it, not the media box.
    const { x, y, width, height } = page.getCropBox();
    const rotate = normalizeRotation(page.getRotation().angle);
    const sideways = rotate === 90 || rotate === 270;
    return {
      w: r2(sideways ? height : width),
      h: r2(sideways ? width : height),
      rotate,
      box: [r2(x), r2(y), r2(width), r2(height)],
    };
  });
  if (pages.some((p) => !(p.w > 0 && p.h > 0))) throw new PdfRejectedError("This PDF has a page with no size.");

  return { numPages, pages };
}
