import { prisma } from "@/lib/prisma";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import { classifyNarration, extractCounterparty } from "./classify";
import { transactionHash } from "./hash";
import { fromDecimal, toDecimalString } from "./money";
import type { ParsedRow } from "./parsers/base";

/**
 * Write parsed rows as BankTransaction rows. Idempotent by construction: each
 * row's deterministic hash is unique per integration and the insert skips
 * conflicts, so importing the same statement (or an overlapping one) twice
 * creates zero duplicates and reports them as skipped.
 */

export type ImportContext = {
  integrationId: string;
  statementId: string;
  currency: string;
  statementDate: string | null;
  gmailMessageId: string | null;
  sourceSubject: string | null;
};

export function toTransactionData(row: ParsedRow, ctx: ImportContext) {
  const type = classifyNarration(row.description);
  const cp = extractCounterparty(row.description, type);
  return {
    integrationId: ctx.integrationId,
    statementId: ctx.statementId,
    rowIndex: row.rowIndex,
    txnDate: toPrismaDate(row.txnDate),
    valueDate: row.valueDate ? toPrismaDate(row.valueDate) : null,
    description: row.description,
    referenceNumber: row.referenceNumber,
    chequeNumber: type === "CHEQUE" ? row.referenceNumber : null,
    direction: row.debit > 0 ? "DEBIT" : "CREDIT",
    debitAmount: toDecimalString(row.debit),
    creditAmount: toDecimalString(row.credit),
    runningBalance: row.balance === null ? null : toDecimalString(row.balance),
    currency: ctx.currency,
    transactionType: type,
    paymentMode: type,
    counterpartyName: cp.counterpartyName,
    upiReference: cp.upiReference,
    bankReference: cp.bankReference ?? (type === "UPI" ? null : row.referenceNumber),
    statementDate: ctx.statementDate ? toPrismaDate(ctx.statementDate) : null,
    gmailMessageId: ctx.gmailMessageId,
    sourceSubject: ctx.sourceSubject,
    rawText: row.rawText,
    transactionHash: transactionHash({
      integrationId: ctx.integrationId,
      txnDate: row.txnDate,
      valueDate: row.valueDate,
      description: row.description,
      referenceNumber: row.referenceNumber,
      debit: row.debit,
      credit: row.credit,
      balance: row.balance,
    }),
  };
}

type Row = ReturnType<typeof toTransactionData>;
type Existing = { txnDate: Date; debitAmount: unknown; creditAmount: unknown; runningBalance: unknown; transactionHash: string };

const day = (d: Date) => d.toISOString().slice(0, 10);
const paise = (v: unknown) => (v === null || v === undefined ? null : fromDecimal(String(v)));

/** Same day, same amount, same balance left behind: the same bank line. */
function lineKey(t: { txnDate: Date; debitAmount: unknown; creditAmount: unknown; runningBalance: unknown }): string | null {
  const bal = paise(t.runningBalance);
  return bal === null ? null : [day(t.txnDate), paise(t.debitAmount), paise(t.creditAmount), bal].join("|");
}

/**
 * Rows already in the account from ANOTHER statement. The hash catches the
 * same line read again from the same kind of file; a PDF and an Excel download
 * of the same days can word a narration differently, so a line with the same
 * day, amount and running balance is the same line too. Each existing line
 * accounts for one incoming row at most, so two genuine same-day payments of
 * the same amount, which leave different balances, stay two rows.
 */
export function knownLines(data: Row[], existing: Existing[]): Set<number> {
  const hashes = new Set(existing.map((e) => e.transactionHash));
  const pool = new Map<string, number>();
  for (const e of existing) {
    const k = lineKey(e);
    if (k) pool.set(k, (pool.get(k) ?? 0) + 1);
  }
  const known = new Set<number>();
  // Exact hash matches first: they use up their own existing line.
  data.forEach((d, i) => {
    if (!hashes.has(d.transactionHash)) return;
    known.add(i);
    const k = lineKey(d);
    if (k && (pool.get(k) ?? 0) > 0) pool.set(k, pool.get(k)! - 1);
  });
  data.forEach((d, i) => {
    if (known.has(i)) return;
    const k = lineKey(d);
    if (k && (pool.get(k) ?? 0) > 0) {
      pool.set(k, pool.get(k)! - 1);
      known.add(i);
    }
  });
  return known;
}

export async function importRows(rows: ParsedRow[], ctx: ImportContext): Promise<{ inserted: number; duplicates: number }> {
  if (rows.length === 0) return { inserted: 0, duplicates: 0 };
  const data = rows.map((r) => toTransactionData(r, ctx));
  const dates = Array.from(new Set(data.map((d) => day(d.txnDate)))).map((d) => toPrismaDate(d));
  const existing = await prisma.bankTransaction.findMany({
    where: { integrationId: ctx.integrationId, txnDate: { in: dates }, statementId: { not: ctx.statementId } },
    select: { txnDate: true, debitAmount: true, creditAmount: true, runningBalance: true, transactionHash: true },
  });
  const known = knownLines(data, existing);
  const fresh = data.filter((_, i) => !known.has(i));
  const { count } = fresh.length ? await prisma.bankTransaction.createMany({ data: fresh, skipDuplicates: true }) : { count: 0 };
  return { inserted: count, duplicates: rows.length - count };
}
