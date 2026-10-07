import { BankAutomationError } from "../errors";
import { hdfcDownloader } from "./hdfc";
import type { StatementDownloader } from "./types";

/** Bank code → statement-link downloader. A bank that attaches the PDF needs none. */
const DOWNLOADERS: Record<string, StatementDownloader> = {
  HDFC: hdfcDownloader,
};

export function downloaderFor(bankCode: string): StatementDownloader {
  const d = DOWNLOADERS[bankCode.toUpperCase()];
  if (!d) throw new BankAutomationError("CONFIG", `No statement downloader for bank "${bankCode}"`);
  return d;
}
