import { get, put } from "@vercel/blob";
import { BankAutomationError } from "./errors";

/**
 * Archive of original statement PDFs in the PRIVATE Blob store — never a
 * public URL. Files come back out only through the authenticated download
 * route, which reuses Finance Documents' serveFinanceDoc.
 *
 *   bank-statements/<bank>/<last4>/<yyyy>/<mm>/<BANK>_<last4>_<yyyy-mm-dd>_<sha8>.pdf
 *
 * The SHA prefix in the stored name keeps two different PDFs for the same day
 * (a re-issued statement) from colliding; the display name drops it.
 */

export function isArchiveConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export function statementFileName(bankCode: string, last4: string, statementDate: string | null): string {
  return `${bankCode.toUpperCase()}_${last4}_${statementDate ?? "undated"}.pdf`;
}

export function statementBlobPath(opts: {
  bankCode: string;
  last4: string;
  statementDate: string | null;
  sha256: string;
}): string {
  const d = opts.statementDate ?? new Date().toISOString().slice(0, 10);
  const [y, m] = d.split("-");
  const base = statementFileName(opts.bankCode, opts.last4, opts.statementDate).replace(/\.pdf$/, "");
  return `bank-statements/${opts.bankCode.toLowerCase()}/${opts.last4}/${y}/${m}/${base}_${opts.sha256.slice(0, 8)}.pdf`;
}

export async function archivePdf(pathname: string, buf: Uint8Array): Promise<void> {
  if (!isArchiveConfigured()) throw new BankAutomationError("STORAGE", "BLOB_READ_WRITE_TOKEN is not set");
  try {
    await put(pathname, Buffer.from(buf), {
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: false,
      // Same path ⇔ same bytes (the SHA is in the name), so a retry rewriting it is harmless.
      allowOverwrite: true,
    });
  } catch (e) {
    throw new BankAutomationError("STORAGE", `Archive upload failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function readArchivedPdf(pathname: string): Promise<Uint8Array> {
  try {
    const res = await get(pathname, { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) throw new Error("not found");
    const chunks: Uint8Array[] = [];
    const reader = (res.stream as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } catch (e) {
    throw new BankAutomationError("STORAGE", `Archived PDF unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
}
