import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_BANK_ENTITY, ENTITY_LABEL, isInvoiceBank, type InvoiceEntityCode } from "@/lib/invoices/core";

/**
 * The account a partner pays its commission into. These are Finance › Invoices'
 * banks, and each belongs to one of DESMA's companies:
 *   - Wio Bank → DESMA International LLC (UAE). Billed exactly as before: this
 *     module's own issuer and bank settings, the D/DLLC series, AED receipts.
 *   - Axis Bank / HDFC Bank → DESMA International Pvt Ltd (India). Billed as an
 *     export: the Invoices letterhead, that bank's printed details and the LUT
 *     line, the E/DIPL series (shared with candidate export invoices), INR receipts.
 */

export const DEFAULT_ACCOUNT = "Wio Bank";

/** Export invoices from India are numbered in this Finance › Invoices series. */
export const EXPORT_SERIES_KEY = "DIPL-EXP";

type Db = Prisma.TransactionClient | typeof prisma;

export type PcAccount = {
  paymentMode: string;
  entityCode: InvoiceEntityCode;
  /** True for the UAE company: this module's own issuer/bank settings, AED receipts. */
  ownSettings: boolean;
  isActive: boolean;
  /** The Indian company's letterhead from Finance › Invoices (empty for the UAE company). */
  issuerName: string;
  issuerLines: string;
  signFor: string;
  thanksLine: string;
  signatoryName: string;
  signature: { bytes: Uint8Array; mime: string } | null;
  /** That bank's printed lines (account name, number, IFSC/SWIFT, branch). */
  bankLines: string[];
  /** The export declaration printed on the invoice. */
  lutLine: string | null;
  /** What still needs filling in before an invoice from this account prints properly. */
  gaps: string[];
};

/** The company that invoices payments into a bank: as set in Finance › Invoices, else the bank's usual one. */
function entityFor(paymentMode: string, configured: string | null | undefined): InvoiceEntityCode {
  if (configured === "DIPL" || configured === "DLLC") return configured;
  return isInvoiceBank(paymentMode) ? DEFAULT_BANK_ENTITY[paymentMode] : "DLLC";
}

export function lutLineFor(arn: string | null | undefined): string | null {
  const a = (arn ?? "").trim();
  return a ? `Supply meant for export under Letter of Undertaking (ARN ${a}) without payment of integrated tax.` : null;
}

function build(
  paymentMode: string,
  bank: { entityCode: string; details: string; isActive: boolean } | null,
  entities: Array<{ code: string; legalName: string; headerLines: string; signFor: string; thanksLine: string; signatoryName: string; lutArn: string | null; signaturePng: Uint8Array | null; signatureMime: string | null }>,
): PcAccount {
  const entityCode = entityFor(paymentMode, bank?.entityCode);
  const ownSettings = entityCode === "DLLC";
  const e = ownSettings ? null : entities.find((x) => x.code === entityCode) ?? null;
  const bankLines = (bank?.details ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const gaps: string[] = [];
  if (!ownSettings) {
    if (!e?.legalName.trim()) gaps.push(`${ENTITY_LABEL[entityCode]}: company name`);
    if (!e?.headerLines.trim()) gaps.push(`${ENTITY_LABEL[entityCode]}: address lines`);
    if (!e?.lutArn?.trim()) gaps.push("LUT ARN (the export declaration)");
    if (!e?.signatoryName.trim()) gaps.push("signatory name");
    if (!bankLines.length) gaps.push(`${paymentMode}: bank details to print`);
  }
  return {
    paymentMode,
    entityCode,
    ownSettings,
    isActive: bank?.isActive ?? paymentMode === DEFAULT_ACCOUNT,
    issuerName: e?.legalName.trim() ?? "",
    issuerLines: e?.headerLines.trim() ?? "",
    signFor: e?.signFor.trim() || (e?.legalName.trim() ? `For ${e.legalName.trim()}` : ""),
    thanksLine: e?.thanksLine.trim() ?? "",
    signatoryName: e?.signatoryName.trim() ?? "",
    signature: e?.signaturePng && e.signatureMime ? { bytes: new Uint8Array(e.signaturePng), mime: e.signatureMime } : null,
    bankLines: ownSettings ? [] : bankLines,
    lutLine: ownSettings ? null : lutLineFor(e?.lutArn),
    gaps,
  };
}

const ENTITY_SELECT = { code: true, legalName: true, headerLines: true, signFor: true, thanksLine: true, signatoryName: true, lutArn: true, signaturePng: true, signatureMime: true } as const;

/** Every account a partner can pay into (Finance › Invoices' banks), Wio first. */
export async function loadAccounts(db: Db = prisma): Promise<PcAccount[]> {
  const [banks, entities] = await Promise.all([db.invoiceBank.findMany({ orderBy: { paymentMode: "asc" } }), db.invoiceEntity.findMany({ select: ENTITY_SELECT })]);
  const modes = [...new Set([DEFAULT_ACCOUNT, ...banks.map((b) => b.paymentMode)])];
  return modes
    .map((m) => build(m, banks.find((b) => b.paymentMode === m) ?? null, entities))
    .sort((a, b) => Number(b.paymentMode === DEFAULT_ACCOUNT) - Number(a.paymentMode === DEFAULT_ACCOUNT) || a.paymentMode.localeCompare(b.paymentMode));
}

/** One account, for an invoice or a partner. An unknown bank falls back to the UAE company's settings. */
export async function loadAccount(db: Db, paymentMode: string): Promise<PcAccount> {
  const [bank, entities] = await Promise.all([db.invoiceBank.findUnique({ where: { paymentMode } }), db.invoiceEntity.findMany({ select: ENTITY_SELECT })]);
  return build(paymentMode, bank, entities);
}
