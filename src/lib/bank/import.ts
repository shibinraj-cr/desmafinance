import { prisma } from "@/lib/prisma";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import { classifyNarration, extractCounterparty } from "./classify";
import { transactionHash } from "./hash";
import { toDecimalString } from "./money";
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

export async function importRows(rows: ParsedRow[], ctx: ImportContext): Promise<{ inserted: number; duplicates: number }> {
  if (rows.length === 0) return { inserted: 0, duplicates: 0 };
  const data = rows.map((r) => toTransactionData(r, ctx));
  const { count } = await prisma.bankTransaction.createMany({ data, skipDuplicates: true });
  return { inserted: count, duplicates: rows.length - count };
}
