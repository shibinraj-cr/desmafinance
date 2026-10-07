import { BankAutomationError } from "./errors";
import type { TextItem } from "./parsers/base";

/**
 * PDF validation and positioned-text extraction (pdf.js via unpdf — the
 * serverless build, no worker, no native deps).
 *
 * A password-protected statement is opened IN MEMORY with the password: no
 * decrypted copy is ever written to disk, so there is no temporary file to
 * clean up, and the archived original stays exactly as the bank sent it.
 */

export const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** Cheap structural checks before anything else touches the bytes. */
export function assertLooksLikePdf(buf: Uint8Array): void {
  if (buf.byteLength === 0) throw new BankAutomationError("PDF_INVALID", "Downloaded file is empty");
  if (buf.byteLength > MAX_PDF_BYTES) throw new BankAutomationError("PDF_INVALID", "Downloaded file is larger than 25 MB");
  const head = Buffer.from(buf.subarray(0, 1024)).toString("latin1");
  if (!head.includes("%PDF-")) {
    const looksHtml = /<html|<!doctype/i.test(head);
    throw new BankAutomationError(
      "PDF_INVALID",
      looksHtml ? "Got an HTML page instead of a PDF" : "Downloaded file is not a PDF",
    );
  }
}

type PdfJsTextItem = { str?: string; transform?: number[]; width?: number };

/**
 * Every text item with its page position, `y` measured from the top. Tries the
 * file unencrypted first, then with the statement password; a wrong password
 * is PDF_PASSWORD (manual action, never retried), a corrupt file PDF_INVALID.
 */
export async function extractTextItems(
  buf: Uint8Array,
  password: string | null,
): Promise<{ items: TextItem[]; pages: number; encrypted: boolean }> {
  assertLooksLikePdf(buf);
  const { getDocumentProxy } = await import("unpdf");

  // pdf.js transfers (detaches) the buffer it is given; hand it copies.
  const open = (pw?: string) =>
    getDocumentProxy(new Uint8Array(buf), { password: pw, isEvalSupported: false, verbosity: 0 });

  let doc;
  let encrypted = false;
  try {
    doc = await open();
  } catch (e) {
    if (!isPasswordError(e)) throw new BankAutomationError("PDF_INVALID", "The PDF could not be opened");
    encrypted = true;
    if (!password) throw new BankAutomationError("PDF_PASSWORD", "The PDF is password protected and no password is configured");
    try {
      doc = await open(password);
    } catch (e2) {
      if (isPasswordError(e2)) {
        throw new BankAutomationError("PDF_PASSWORD", "The statement password does not open this PDF");
      }
      throw new BankAutomationError("PDF_INVALID", "The PDF could not be opened");
    }
  }

  try {
    const items: TextItem[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const height = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      for (const raw of content.items as PdfJsTextItem[]) {
        const str = raw.str ?? "";
        if (!str.trim() || !raw.transform) continue;
        items.push({
          str,
          x: round(raw.transform[4]),
          y: round(height - raw.transform[5]),
          w: round(raw.width ?? 0),
          page: p,
        });
      }
      page.cleanup();
    }
    return { items, pages: doc.numPages, encrypted };
  } finally {
    await doc.destroy();
  }
}

function isPasswordError(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? "";
  const msg = e instanceof Error ? e.message : String(e);
  return name === "PasswordException" || /password/i.test(msg);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
