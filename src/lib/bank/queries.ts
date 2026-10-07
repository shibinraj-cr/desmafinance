import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fromPrismaDate, toPrismaDate } from "@/lib/lead-pulse-dates";
import { TRANSACTION_TYPES } from "./classify";

/**
 * Read side of Bank Statements, shared by the page, the JSON API and the
 * exports so the three can never disagree about what a filter means.
 * Nothing here selects a secret column.
 */

export const RECON_STATUSES = ["UNMATCHED", "MATCHED", "PARTIALLY_MATCHED", "IGNORED", "MANUAL_REVIEW"] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

export type TxnFilters = {
  integrationId?: string;
  from?: string;
  to?: string;
  direction?: "DEBIT" | "CREDIT";
  types: string[];
  recon: string[];
  min?: number;
  max?: number;
  q?: string;
  statementId?: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function all(p: Params, k: string): string[] {
  if (p instanceof URLSearchParams) return p.getAll(k).filter(Boolean);
  const v = p[k];
  return (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
}
function one(p: Params, k: string): string | undefined {
  return all(p, k)[0];
}

export function parseTxnFilters(p: Params): TxnFilters {
  const num = (s?: string) => (s && Number.isFinite(Number(s)) ? Number(s) : undefined);
  const dir = one(p, "direction");
  return {
    integrationId: one(p, "account"),
    from: ISO.test(one(p, "from") ?? "") ? one(p, "from") : undefined,
    to: ISO.test(one(p, "to") ?? "") ? one(p, "to") : undefined,
    direction: dir === "DEBIT" || dir === "CREDIT" ? dir : undefined,
    types: all(p, "type").filter((t) => (TRANSACTION_TYPES as readonly string[]).includes(t)),
    recon: all(p, "recon").filter((t) => (RECON_STATUSES as readonly string[]).includes(t)),
    min: num(one(p, "min")),
    max: num(one(p, "max")),
    q: one(p, "q")?.trim().slice(0, 100) || undefined,
    statementId: one(p, "statement"),
  };
}

export function txnWhere(f: TxnFilters): Prisma.BankTransactionWhereInput {
  const and: Prisma.BankTransactionWhereInput[] = [];
  if (f.integrationId) and.push({ integrationId: f.integrationId });
  if (f.statementId) and.push({ statementId: f.statementId });
  if (f.from) and.push({ txnDate: { gte: toPrismaDate(f.from) } });
  if (f.to) and.push({ txnDate: { lte: toPrismaDate(f.to) } });
  if (f.direction) and.push({ direction: f.direction });
  if (f.types.length) and.push({ transactionType: { in: f.types } });
  if (f.recon.length) and.push({ reconciliationStatus: { in: f.recon } });
  const amountField = f.direction === "DEBIT" ? "debitAmount" : f.direction === "CREDIT" ? "creditAmount" : null;
  if (f.min !== undefined || f.max !== undefined) {
    const range = { ...(f.min !== undefined ? { gte: f.min } : {}), ...(f.max !== undefined ? { lte: f.max } : {}) };
    and.push(
      amountField
        ? { [amountField]: range }
        : { OR: [{ debitAmount: range }, { creditAmount: range }] },
    );
  }
  if (f.q) {
    and.push({
      OR: [
        { description: { contains: f.q, mode: "insensitive" } },
        { referenceNumber: { contains: f.q, mode: "insensitive" } },
        { counterpartyName: { contains: f.q, mode: "insensitive" } },
        { upiReference: { contains: f.q } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export const TXN_SELECT = {
  id: true,
  txnDate: true,
  valueDate: true,
  description: true,
  referenceNumber: true,
  chequeNumber: true,
  direction: true,
  debitAmount: true,
  creditAmount: true,
  runningBalance: true,
  transactionType: true,
  counterpartyName: true,
  upiReference: true,
  reconciliationStatus: true,
  reconciliationNote: true,
  statementId: true,
  statementDate: true,
  transactionHash: true,
  integration: { select: { bankName: true, accountLastFour: true } },
  _count: { select: { matches: true } },
} satisfies Prisma.BankTransactionSelect;

export type TxnRow = {
  id: string;
  txnDate: string;
  valueDate: string | null;
  description: string;
  reference: string | null;
  direction: string;
  debit: number;
  credit: number;
  balance: number | null;
  type: string;
  counterparty: string | null;
  recon: string;
  reconNote: string | null;
  matches: number;
  account: string;
  statementId: string;
  statementDate: string | null;
  hash: string;
};

export function serializeTxn(t: Prisma.BankTransactionGetPayload<{ select: typeof TXN_SELECT }>): TxnRow {
  return {
    id: t.id,
    txnDate: fromPrismaDate(t.txnDate),
    valueDate: t.valueDate ? fromPrismaDate(t.valueDate) : null,
    description: t.description,
    reference: t.chequeNumber ?? t.referenceNumber,
    direction: t.direction,
    debit: Number(t.debitAmount.toString()),
    credit: Number(t.creditAmount.toString()),
    balance: t.runningBalance === null ? null : Number(t.runningBalance.toString()),
    type: t.transactionType,
    counterparty: t.counterpartyName,
    recon: t.reconciliationStatus,
    reconNote: t.reconciliationNote,
    matches: t._count.matches,
    account: `${t.integration.bankName} ••••${t.integration.accountLastFour}`,
    statementId: t.statementId,
    statementDate: t.statementDate ? fromPrismaDate(t.statementDate) : null,
    hash: t.transactionHash,
  };
}

export async function listTransactions(f: TxnFilters, page: number, pageSize = 50) {
  const where = txnWhere(f);
  const [rows, total, sums] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      select: TXN_SELECT,
      orderBy: [{ txnDate: "desc" }, { statementId: "desc" }, { rowIndex: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.bankTransaction.count({ where }),
    prisma.bankTransaction.aggregate({ where, _sum: { debitAmount: true, creditAmount: true } }),
  ]);
  return {
    rows: rows.map(serializeTxn),
    total,
    totalDebit: Number(sums._sum.debitAmount?.toString() ?? 0),
    totalCredit: Number(sums._sum.creditAmount?.toString() ?? 0),
  };
}

export const STATEMENT_SELECT = {
  id: true,
  source: true,
  periodStart: true,
  periodEnd: true,
  gmailMessageId: true,
  gmailReceivedAt: true,
  sourceSubject: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  lastErrorCode: true,
  lastError: true,
  fileName: true,
  fileSize: true,
  blobPathname: true,
  openingBalance: true,
  closingBalance: true,
  totalDebit: true,
  totalCredit: true,
  transactionCount: true,
  insertedCount: true,
  duplicateCount: true,
  validation: true,
  processedAt: true,
  createdAt: true,
  integration: { select: { bankName: true, accountLastFour: true } },
} satisfies Prisma.BankStatementSelect;

export type StatementRow = {
  id: string;
  source: string;
  periodStart: string | null;
  periodEnd: string | null;
  account: string;
  receivedAt: string | null;
  gmailMessageId: string | null;
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  hasPdf: boolean;
  fileName: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  totalDebit: number | null;
  totalCredit: number | null;
  transactionCount: number | null;
  insertedCount: number | null;
  duplicateCount: number | null;
  errors: string[];
  warnings: string[];
  processedAt: string | null;
};

const n = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

export function serializeStatement(s: Prisma.BankStatementGetPayload<{ select: typeof STATEMENT_SELECT }>): StatementRow {
  const v = (s.validation ?? {}) as { errors?: string[]; warnings?: string[] };
  return {
    id: s.id,
    source: s.source,
    periodStart: s.periodStart ? fromPrismaDate(s.periodStart) : null,
    periodEnd: s.periodEnd ? fromPrismaDate(s.periodEnd) : null,
    account: `${s.integration.bankName} ••••${s.integration.accountLastFour}`,
    receivedAt: s.gmailReceivedAt?.toISOString() ?? null,
    gmailMessageId: s.gmailMessageId,
    status: s.status,
    attempts: s.attempts,
    nextAttemptAt: s.nextAttemptAt?.toISOString() ?? null,
    lastErrorCode: s.lastErrorCode,
    lastError: s.lastError,
    hasPdf: !!s.blobPathname,
    fileName: s.fileName,
    openingBalance: n(s.openingBalance),
    closingBalance: n(s.closingBalance),
    totalDebit: n(s.totalDebit),
    totalCredit: n(s.totalCredit),
    transactionCount: s.transactionCount,
    insertedCount: s.insertedCount,
    duplicateCount: s.duplicateCount,
    errors: v.errors ?? [],
    warnings: v.warnings ?? [],
    processedAt: s.processedAt?.toISOString() ?? null,
  };
}

/** Recompute a bank line's reconciliation status from its matches (unless set by hand to IGNORED/MANUAL_REVIEW). */
export function reconStatusFor(amount: number, matched: number): ReconStatus {
  if (matched <= 0) return "UNMATCHED";
  return Math.round(matched * 100) >= Math.round(amount * 100) ? "MATCHED" : "PARTIALLY_MATCHED";
}
